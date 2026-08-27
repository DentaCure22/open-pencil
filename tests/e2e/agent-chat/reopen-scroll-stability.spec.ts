import { expect, test, type Page } from "@playwright/test";

import { CanvasHelper } from "#tests/helpers/canvas";

function existingThread(id: string, task: string) {
  const updatedAt = "2026-08-26T18:00:00.000Z";
  return {
    canFollowUp: true,
    createdAt: updatedAt,
    effort: "medium",
    id,
    messages: Array.from({ length: 32 }, (_, index) => ({
      createdAt: new Date(Date.UTC(2026, 7, 26, 18, 0, index)).toISOString(),
      id: `${id}-message-${String(index)}`,
      role: index % 2 === 0 ? "user" : "assistant",
      text: `${task} message ${String(index + 1)} with enough text to keep the old chat scrollable.`,
    })),
    model: "xai-auth/grok-4.6",
    recentUpdate: "Done.",
    state: "completed",
    task,
    updatedAt,
  };
}

async function mockExistingThreads(page: Page) {
  const threads = [
    existingThread("remembered-thread", "Remembered existing chat"),
    existingThread("other-thread", "Other existing chat"),
  ];
  await Promise.all([
    page.route(/\/agent-router\/v1\/pi\/conversations\?preview=1$/, (route) =>
      route.fulfill({
        body: JSON.stringify({ threads }),
        contentType: "application/json",
      }),
    ),
    page.route(/\/agent-router\/v1\/pi\/conversations\/[^/?]+$/, (route) => {
      const id = decodeURIComponent(
        route.request().url().split("/conversations/")[1] ?? "",
      );
      const thread = threads.find((candidate) => candidate.id === id);
      return route.fulfill({
        body: JSON.stringify(thread ?? {}),
        contentType: "application/json",
        status: thread ? 200 : 404,
      });
    }),
    page.route(/\/agent-router\/v1\/pi\/models$/, (route) =>
      route.fulfill({
        body: JSON.stringify({
          models: [
            {
              defaultEffort: "high",
              efforts: ["low", "medium", "high"],
              group: "xAI",
              id: "xai-auth/grok-4.6",
              label: "Grok 4.6",
            },
          ],
        }),
        contentType: "application/json",
      }),
    ),
  ]);
}

async function openWithMotionProbe(
  page: Page,
  threadId: string,
  anchorId: string,
) {
  const motion = page.evaluate(
    ({ anchorId: expectedAnchorId, threadId: expectedThreadId }) =>
      new Promise<Array<number | null>>((resolve) => {
        document.body.dataset.reopenScrollProbe = "ready";
        const samples: Array<number | null> = [];
        const onClick = (event: MouseEvent) => {
          const target = event.target instanceof Element ? event.target : null;
          if (
            !target?.closest(
              `[data-test-id="agent-chat-thread-agent:${expectedThreadId}"]`,
            )
          ) {
            return;
          }
          document.removeEventListener("click", onClick, true);
          let frame = 0;
          const sample = () => {
            const viewport = document.querySelector<HTMLElement>(
              '[data-test-id="agent-selected-conversation"] [data-test-id="ai-conversation-viewport"]',
            );
            const anchor = [
              ...(viewport?.querySelectorAll<HTMLElement>(
                "[data-message-id]",
              ) ?? []),
            ].find((element) => element.dataset.messageId === expectedAnchorId);
            const hidden = viewport?.firstElementChild
              ? getComputedStyle(viewport.firstElementChild).visibility ===
                "hidden"
              : true;
            samples.push(
              viewport && anchor && !hidden
                ? Math.round(
                    anchor.getBoundingClientRect().top -
                      viewport.getBoundingClientRect().top,
                  )
                : null,
            );
            frame += 1;
            if (frame >= 20) {
              delete document.body.dataset.reopenScrollProbe;
              resolve(samples);
              return;
            }
            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        };
        document.addEventListener("click", onClick, true);
      }),
    { anchorId, threadId },
  );
  await expect(page.locator("body")).toHaveAttribute(
    "data-reopen-scroll-probe",
    "ready",
  );
  await page.getByTestId(`agent-chat-thread-agent:${threadId}`).click();
  return await motion;
}

function expectStableVisibleMotion(samples: Array<number | null>) {
  expect(samples.length).toBeGreaterThan(1);
  const firstVisible = samples.findIndex((sample) => sample !== null);
  expect(firstVisible).toBeGreaterThanOrEqual(0);
  expect(
    samples
      .slice(firstVisible)
      .every((sample): sample is number => sample !== null),
  ).toBe(true);
  const positions = samples
    .slice(firstVisible)
    .filter((sample): sample is number => sample !== null);
  expect(Math.max(...positions) - Math.min(...positions)).toBeLessThanOrEqual(
    1,
  );
  return positions;
}

test("opens an existing chat at the live edge before its first visible frame", async ({
  page,
}) => {
  await mockExistingThreads(page);
  await page.goto("/?test&no-rulers");
  await new CanvasHelper(page).waitForInit();

  await page.getByRole("button", { name: "Expand Chats" }).click();

  const samples = await openWithMotionProbe(
    page,
    "remembered-thread",
    "agent:remembered-thread:remembered-thread-message-31",
  );
  expectStableVisibleMotion(samples);
  await expect
    .poll(() =>
      page
        .getByTestId("agent-selected-conversation")
        .getByTestId("ai-conversation-viewport")
        .evaluate(
          (element) =>
            element.scrollHeight - element.scrollTop - element.clientHeight,
        ),
    )
    .toBeLessThanOrEqual(1);
});

test("restores a previously read position without a visible snap", async ({
  page,
}) => {
  await mockExistingThreads(page);
  await page.goto("/?test&no-rulers");
  await new CanvasHelper(page).waitForInit();

  await page.getByRole("button", { name: "Expand Chats" }).click();
  await page.getByTestId("agent-chat-thread-agent:remembered-thread").click();
  const conversation = page.getByTestId("agent-selected-conversation");
  const viewport = conversation.getByTestId("ai-conversation-viewport");
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollHeight))
    .toBeGreaterThan(800);
  await viewport.hover();
  await page.mouse.wheel(0, -1_200);
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) =>
          element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeGreaterThan(500);
  const remembered = await viewport.evaluate((element) => {
    const viewportBounds = element.getBoundingClientRect();
    const anchor = [
      ...element.querySelectorAll<HTMLElement>("[data-message-id]"),
    ].find((item) => {
      const bounds = item.getBoundingClientRect();
      return (
        bounds.top >= viewportBounds.top &&
        bounds.bottom <= viewportBounds.bottom
      );
    });
    const id = anchor?.dataset.messageId;
    if (!anchor || !id)
      throw new Error("Visible remembered message unavailable");
    return {
      id,
      top: Math.round(anchor.getBoundingClientRect().top - viewportBounds.top),
    };
  });

  await conversation.getByTestId("agent-thread-back").click();
  await page.getByTestId("agent-chat-thread-agent:other-thread").click();
  await expect(
    conversation.getByTestId("agent-selected-header-title"),
  ).toContainText("Other existing chat");
  await conversation.getByTestId("agent-thread-back").click();

  const positions = expectStableVisibleMotion(
    await openWithMotionProbe(page, "remembered-thread", remembered.id),
  );
  expect(positions.at(-1)).toBe(remembered.top);
});
