# T-032 · flood playback traffic check

Building edge, light and dark, 1440 × 900. Captured in the production build running at
`localhost:5321`, with the real Elmina API, medium quality and Motion on. Chromium uses
SwiftShader; these captures do not measure hardware performance. Live model turns: 0.

| State | Light | Dark |
| --- | --- | --- |
| Before load, moving cars, first frame | [JPG](building-before-1-day.jpg) | [JPG](building-before-1-night.jpg) |
| Before load, moving cars, second frame | [JPG](building-before-2-day.jpg) | [JPG](building-before-2-night.jpg) |
| Story ready, Building edge paused | [JPG](building-after-day.jpg) | [JPG](building-after-night.jpg) |
| After Exit story, cars restored | [JPG](building-restored-day.jpg) | [JPG](building-restored-night.jpg) |

The two before frames use a fixed camera and are separated by at least 1.3 seconds.
The acceptance hook reads the actual decorative instance matrices: visible car positions
change before load, no moving-car instances remain after the shared fade, and people remain visible.
Seeking to River rise and back keeps cars hidden. Exit restores visible cars and people.
Parked decorative cars remain; the shared switch controls moving cars only.
The before/exit camera targets the same building as the cinematic; the ordinary map and
cinematic use their existing different fields of view. No traffic state is set by the probe.

The native Watch, Building edge and Exit buttons drive the checked transition. The initial
acceptance-hook start only locates the building for the before camera. All river classifications,
counts and route caveats still come from the existing API. External font requests are blocked
for repeatable captures. All review images are JPG; this step creates no PDF.
