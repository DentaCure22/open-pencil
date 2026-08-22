import { createServer } from 'node:net'

export async function assertLocalAuthorityPortAvailable(host: string, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(port, host, () => {
      probe.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  })
}
