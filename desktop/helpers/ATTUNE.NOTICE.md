# Attune capture provenance

OpenPencil's external live-surface transport is an independent integration based on the
capture architecture demonstrated by Panchangam Panchalingam's Attune project at commit
`395ba5e9568c40cc286adc503ede85f68ece8009`.

The adopted mechanisms are a desktop-independent ScreenCaptureKit window filter, bounded
`sourceRect`, Retina point-to-pixel scaling, a two-frame capture queue, JPEG transport, and
independent latest-frame encode/write queues. Attune's destination UI and DOM-twin styling
are not included.

The referenced repository did not contain a license file or package license declaration at
the time of integration (2026-08-22), so no Attune source file is copied or redistributed
here. This notice preserves design provenance while OpenPencil ships its own implementation.
