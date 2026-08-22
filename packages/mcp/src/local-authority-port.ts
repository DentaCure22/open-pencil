import { createServer } from 'node:net'

export async function assertLocalAuthorityPortAvailable(host: string, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer()
    // A browser tab can reconnect in the brief interval while the probe owns the
    // port. Destroy those probe-only sockets so close() cannot wait on them and
    // stall the real authority before it starts listening.
    probe.on('connection', (socket) => socket.destroy())
    probe.once('error', reject)
    probe.listen(port, host, () => {
      probe.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  })
}
