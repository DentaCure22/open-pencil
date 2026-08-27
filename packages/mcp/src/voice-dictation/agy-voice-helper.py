#!/usr/bin/env python3
"""Drive agy's interactive /voice command over a private PTY.

The CLI deliberately rejects /voice in print mode. This helper gives the local
authority a small JSON-lines protocol while leaving OAuth and transcription
inside the unmodified interactive agy process. Browser microphone PCM reaches
agy through its official ANTIGRAVITY_MIC stream.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import pty
import re
import select
import signal
import struct
import sys
import termios
import time
import uuid
from pathlib import Path
from typing import Any


STARTUP_TIMEOUT_SECONDS = 45.0
FINISH_TIMEOUT_SECONDS = 30.0
SESSION_TIMEOUT_SECONDS = 10 * 60.0
HISTORY_TIMEOUT_SECONDS = 5.0
TERMINAL_COLUMNS = 120
TERMINAL_ROWS = 34
CONTEXT_READY_MARKER = "OPENPENCIL_VOICE_CONTEXT_READY"


class TerminalScreen:
    """Small VT screen model for agy's cursor-addressed prompt updates."""

    def __init__(self, rows: int, columns: int) -> None:
        self.rows = rows
        self.columns = columns
        self.lines = [[" "] * columns for _ in range(rows)]
        self.row = 0
        self.column = 0
        self.saved_cursor = (0, 0)
        self.pending = ""

    def _linefeed(self) -> None:
        if self.row >= self.rows - 1:
            self.lines.pop(0)
            self.lines.append([" "] * self.columns)
            self.row = self.rows - 1
            return
        self.row += 1

    def _parameter_values(self, value: str) -> list[int]:
        if value.startswith("?"):
            value = value[1:]
        result = []
        for item in value.split(";"):
            try:
                result.append(int(item) if item else 0)
            except ValueError:
                result.append(0)
        return result or [0]

    def _erase_line(self, mode: int) -> None:
        if mode == 1:
            self.lines[self.row][: self.column + 1] = [" "] * (self.column + 1)
        elif mode == 2:
            self.lines[self.row] = [" "] * self.columns
        else:
            self.lines[self.row][self.column :] = [" "] * (self.columns - self.column)

    def _erase_display(self, mode: int) -> None:
        if mode in (2, 3):
            self.lines = [[" "] * self.columns for _ in range(self.rows)]
            self.row = 0
            self.column = 0
            return
        if mode == 1:
            for row in range(self.row):
                self.lines[row] = [" "] * self.columns
            self.lines[self.row][: self.column + 1] = [" "] * (self.column + 1)
            return
        self.lines[self.row][self.column :] = [" "] * (self.columns - self.column)
        for row in range(self.row + 1, self.rows):
            self.lines[row] = [" "] * self.columns

    def _csi(self, parameters: str, command: str) -> None:
        values = self._parameter_values(parameters)
        amount = max(1, values[0])
        if command == "A":
            self.row = max(0, self.row - amount)
        elif command in ("B", "e"):
            self.row = min(self.rows - 1, self.row + amount)
        elif command in ("C", "a"):
            self.column = min(self.columns - 1, self.column + amount)
        elif command == "D":
            self.column = max(0, self.column - amount)
        elif command == "E":
            self.row = min(self.rows - 1, self.row + amount)
            self.column = 0
        elif command == "F":
            self.row = max(0, self.row - amount)
            self.column = 0
        elif command in ("G", "`"):
            self.column = min(self.columns - 1, max(0, amount - 1))
        elif command == "d":
            self.row = min(self.rows - 1, max(0, amount - 1))
        elif command in ("H", "f"):
            target_row = max(1, values[0] or 1)
            target_column = max(1, values[1] if len(values) > 1 and values[1] else 1)
            self.row = min(self.rows - 1, target_row - 1)
            self.column = min(self.columns - 1, target_column - 1)
        elif command == "J":
            self._erase_display(values[0])
        elif command == "K":
            self._erase_line(values[0])
        elif command == "P":
            line = self.lines[self.row]
            del line[self.column : self.column + amount]
            line.extend([" "] * amount)
        elif command == "@":
            line = self.lines[self.row]
            line[self.column : self.column] = [" "] * amount
            del line[self.columns :]
        elif command == "X":
            end = min(self.columns, self.column + amount)
            self.lines[self.row][self.column : end] = [" "] * (end - self.column)
        elif command == "s":
            self.saved_cursor = (self.row, self.column)
        elif command == "u":
            self.row, self.column = self.saved_cursor
        elif command in ("h", "l") and "1049" in parameters:
            self._erase_display(2)

    def _write(self, value: str) -> None:
        self.lines[self.row][self.column] = value
        if self.column >= self.columns - 1:
            self.column = 0
            self._linefeed()
        else:
            self.column += 1

    def feed(self, value: str) -> None:
        data = self.pending + value
        self.pending = ""
        index = 0
        while index < len(data):
            character = data[index]
            if character == "\x1b":
                if index + 1 >= len(data):
                    self.pending = data[index:]
                    return
                following = data[index + 1]
                if following == "[":
                    end = index + 2
                    while end < len(data) and not ("@" <= data[end] <= "~"):
                        end += 1
                    if end >= len(data):
                        self.pending = data[index:]
                        return
                    self._csi(data[index + 2 : end], data[end])
                    index = end + 1
                    continue
                if following == "]":
                    bell = data.find("\x07", index + 2)
                    terminator = data.find("\x1b\\", index + 2)
                    endings = [item for item in (bell, terminator) if item >= 0]
                    if not endings:
                        self.pending = data[index:]
                        return
                    end = min(endings)
                    index = end + (2 if data.startswith("\x1b\\", end) else 1)
                    continue
                if following == "7":
                    self.saved_cursor = (self.row, self.column)
                elif following == "8":
                    self.row, self.column = self.saved_cursor
                index += 2
                continue
            if character == "\r":
                self.column = 0
            elif character in ("\n", "\x0b", "\x0c"):
                self._linefeed()
            elif character == "\b":
                self.column = max(0, self.column - 1)
            elif character == "\t":
                self.column = min(self.columns - 1, ((self.column // 8) + 1) * 8)
            elif character >= " ":
                self._write(character)
            index += 1

    def text(self, row: int) -> str:
        return "".join(self.lines[row]).rstrip()


def screen_dictation_transcript(screen: TerminalScreen) -> str:
    status_row = None
    for row in range(screen.rows - 1, -1, -1):
        if "Recording 00:" in screen.text(row):
            status_row = row
            break
    if status_row is None or status_row < 2:
        return ""

    transcript_rows = []
    row = status_row - 2
    while row >= 0:
        line = screen.text(row)
        if not line.strip():
            break
        transcript_rows.append(line)
        row -= 1
    transcript_rows.reverse()
    return clean_screen_transcript("".join(transcript_rows))


def clean_screen_transcript(value: str) -> str:
    """Remove prompt decorations left behind during cursor-addressed rewrites."""
    without_borders = re.sub(r"[\u2500-\u257f]{3,}\s*", " ", value)
    return re.sub(r"[ \t]+", " ", without_borders).strip()


def emit(phase: str, **values: Any) -> None:
    sys.stdout.write(json.dumps({"phase": phase, **values}, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def history_transcript(history_path: Path, marker: str) -> str | None:
    prefix = f"/help {marker} "
    try:
        with history_path.open("r", encoding="utf-8") as history:
            for line in history:
                try:
                    item = json.loads(line)
                except json.JSONDecodeError:
                    continue
                display = item.get("display")
                if not isinstance(display, str):
                    continue
                index = display.find(prefix)
                if index >= 0:
                    return display[index + len(prefix) :].strip()
    except FileNotFoundError:
        return None
    return None


def terminate_cli(pid: int, fd: int) -> None:
    try:
        os.write(fd, b"\x03")
        time.sleep(0.2)
        os.write(fd, b"\x03")
    except OSError:
        pass
    deadline = time.monotonic() + 1.0
    while time.monotonic() < deadline:
        try:
            completed, _ = os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            return
        if completed:
            return
        time.sleep(0.05)
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    deadline = time.monotonic() + 1.0
    while time.monotonic() < deadline:
        try:
            completed, _ = os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            return
        if completed:
            return
        time.sleep(0.05)
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        return
    # Agy can linger briefly in macOS's exiting state after SIGKILL. Never keep
    # the bridge helper (and its manager session) blocked on an unbounded reap.
    deadline = time.monotonic() + 0.5
    while time.monotonic() < deadline:
        try:
            completed, _ = os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            return
        if completed:
            return
        time.sleep(0.05)


def error_from_screen(screen: str) -> tuple[str, str] | None:
    messages = (
        (
            "another session on this account is already using voice input",
            "voice_session_busy",
            "Another Antigravity session is already using voice input.",
        ),
        (
            "daily voice transcription limit for this account is used up",
            "voice_limit_reached",
            "The Antigravity voice transcription limit has been reached.",
        ),
        (
            "Voice dictation needs a permission your current sign-in does not carry",
            "voice_permission_unavailable",
            "This Antigravity sign-in cannot use voice dictation.",
        ),
        (
            "No speech detected",
            "no_speech",
            "No speech was detected.",
        ),
    )
    for fragment, code, message in messages:
        if fragment in screen:
            return code, message
    return None


def parse_command(line: bytes) -> str | None:
    try:
        value = json.loads(line.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    command = value.get("command") if isinstance(value, dict) else None
    return command if isinstance(command, str) else None


def exit_for_signal(_signum: int, _frame: Any) -> None:
    raise SystemExit(0)


def agy_command(args: argparse.Namespace) -> list[str]:
    prompt = (
        "Prepare for one upcoming /voice dictation. Do not use tools. "
        f"Reply only {CONTEXT_READY_MARKER}."
    )
    return [
        args.agy,
        "--mode",
        "plan",
        "--prompt-interactive",
        prompt,
    ]


def run(args: argparse.Namespace) -> int:
    marker = f"__OPENPENCIL_VOICE_{uuid.uuid4().hex}__"
    history_path = Path(args.history).expanduser()
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(args.cwd)
        env = os.environ.copy()
        env["AGY_CLI_HIDE_LOGO"] = "1"
        env["AGY_CLI_DISABLE_ESCAPE_SEQUENCE_OPTIMIZATIONS"] = "1"
        os.execvpe(args.agy, agy_command(args), env)

    signal.signal(signal.SIGINT, exit_for_signal)
    signal.signal(signal.SIGTERM, exit_for_signal)
    fcntl.ioctl(
        fd,
        termios.TIOCSWINSZ,
        struct.pack("HHHH", TERMINAL_ROWS, TERMINAL_COLUMNS, 0, 0),
    )
    started_at = time.monotonic()
    voice_requested_at: float | None = None
    recording_announced = False
    stop_requested_at: float | None = None
    capture_requested_at: float | None = None
    saw_finishing = False
    recent_screen = ""
    terminal_screen = TerminalScreen(TERMINAL_ROWS, TERMINAL_COLUMNS)
    live_transcript = ""
    emit("starting")

    try:
        while time.monotonic() - started_at < SESSION_TIMEOUT_SECONDS:
            readable, _, _ = select.select([fd, sys.stdin.buffer], [], [], 0.1)
            if fd in readable:
                try:
                    chunk = os.read(fd, 65536)
                except OSError:
                    chunk = b""
                if not chunk:
                    error = error_from_screen(recent_screen)
                    if error:
                        emit("error", code=error[0], error=error[1])
                    else:
                        emit("error", code="agy_exited", error="Antigravity voice input exited unexpectedly.")
                    return 1
                decoded = chunk.decode("utf-8", "ignore")
                recent_screen = (recent_screen + decoded)[-100_000:]
                error = error_from_screen(recent_screen)
                if error:
                    emit("error", code=error[0], error=error[1])
                    return 1

                context_ready = (
                    recent_screen.rfind(CONTEXT_READY_MARKER) >= 0
                    and recent_screen.rfind("? for shortcuts")
                    > recent_screen.rfind(CONTEXT_READY_MARKER)
                )
                if voice_requested_at is None and context_ready and (
                    "? for shortcuts" in recent_screen or "Plan mode:" in recent_screen
                ):
                    os.write(fd, b"/voice\r")
                    voice_requested_at = time.monotonic()
                    emit("connecting")
                if (
                    voice_requested_at is not None
                    and not recording_announced
                    and "Recording 00:" in recent_screen
                ):
                    status_index = recent_screen.find("Recording 00:")
                    recording_region = recent_screen.rfind("\r\n\n", 0, status_index + 1)
                    terminal_screen = TerminalScreen(TERMINAL_ROWS, TERMINAL_COLUMNS)
                    terminal_screen.row = TERMINAL_ROWS // 2
                    terminal_screen.feed(recent_screen[max(0, recording_region) :])
                    emit("recording")
                    recording_announced = True
                elif recording_announced:
                    terminal_screen.feed(decoded)
                if recording_announced and stop_requested_at is None:
                    current_transcript = screen_dictation_transcript(terminal_screen)
                    if current_transcript and current_transcript != live_transcript:
                        live_transcript = current_transcript
                        emit("recording", transcript=current_transcript)
                if stop_requested_at is not None:
                    if "Finishing up..." in decoded:
                        saw_finishing = True
                    if saw_finishing and "? for shortcuts" in decoded and capture_requested_at is None:
                        os.write(fd, b"\x01")
                        os.write(fd, f"/help {marker} ".encode("utf-8"))
                        os.write(fd, b"\r")
                        capture_requested_at = time.monotonic()

            if sys.stdin.buffer in readable:
                line = sys.stdin.buffer.readline()
                command = parse_command(line)
                if command == "cancel" or not line:
                    try:
                        os.write(fd, b"\x1b")
                    except OSError:
                        pass
                    emit("cancelled")
                    return 0
                if command == "stop" and stop_requested_at is None:
                    if not recording_announced:
                        try:
                            os.write(fd, b"\x1b")
                        except OSError:
                            pass
                        emit("cancelled")
                        return 0
                    os.write(fd, b"\r")
                    stop_requested_at = time.monotonic()
                    emit("finishing")

            now = time.monotonic()
            if voice_requested_at is None and now - started_at > STARTUP_TIMEOUT_SECONDS:
                emit("error", code="agy_start_timeout", error="Antigravity voice input did not start.")
                return 1
            if stop_requested_at is not None and capture_requested_at is None:
                if now - stop_requested_at > FINISH_TIMEOUT_SECONDS:
                    emit("error", code="voice_finish_timeout", error="Antigravity did not finish the transcript.")
                    return 1
            if capture_requested_at is not None:
                transcript = history_transcript(history_path, marker)
                if transcript:
                    emit("ready", transcript=transcript)
                    return 0
                if now - capture_requested_at > HISTORY_TIMEOUT_SECONDS:
                    emit("error", code="transcript_unavailable", error="The transcript was not returned by Antigravity.")
                    return 1

        emit("error", code="voice_session_timeout", error="Antigravity voice input exceeded ten minutes.")
        return 1
    finally:
        terminate_cli(pid, fd)
        try:
            os.close(fd)
        except OSError:
            pass


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--agy", default=os.environ.get("AGY_BIN", "agy"))
    parser.add_argument("--cwd", required=True)
    parser.add_argument(
        "--history",
        default=str(Path.home() / ".gemini" / "antigravity-cli" / "history.jsonl"),
    )
    return run(parser.parse_args())


if __name__ == "__main__":
    raise SystemExit(main())
