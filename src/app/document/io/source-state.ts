export function createDocumentSourceState() {
  let fileHandle: FileSystemFileHandle | null = null
  let filePath: string | null = null
  let downloadName: string | null = null
  let sourceFormat: string | null = null
  let savedVersion = 0
  let lastWriteTime = 0

  return {
    getFileHandle: () => fileHandle,
    setFileHandle: (handle: FileSystemFileHandle | null) => {
      fileHandle = handle
    },
    getFilePath: () => filePath,
    setFilePath: (path: string | null) => {
      filePath = path
    },
    getDownloadName: () => downloadName,
    setDownloadName: (name: string | null) => {
      downloadName = name
    },
    getSourceFormat: () => sourceFormat,
    setSourceFormat: (format: string | null) => {
      sourceFormat = format
    },
    getSavedVersion: () => savedVersion,
    setSavedVersion: (version: number) => {
      savedVersion = version
    },
    getLastWriteTime: () => lastWriteTime,
    setLastWriteTime: (time: number) => {
      lastWriteTime = time
    }
  }
}
