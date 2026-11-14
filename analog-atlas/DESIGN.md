# Analog Atlas · Design system

## World
A dialogue between two worlds on a calm instrument ground. **Earth is blue, the target world is red**,
everywhere: A/B tags, bullet marks, map pins, profile lines, the homepage tether. White carries data
and the primary action. Derived from NASA's red/blue/white identity, set dark because the work is
reading maps and numbers for long stretches.

## Colour (src/styles/base.css)
| Token | Value | Job |
|---|---|---|
| --bg … --bg-4 | #03060d → #1a2846 | navy grounds, panels, raised surfaces |
| --text / -2 / -3 | #eef3fc / #b3c0d8 / #8795b1 | body ≥ 4.5:1 on panels |
| --earth / --earth-2 | #4c8dff / #9cc2ff | Earth side, met states, suitability ramp |
| --target / --target-2 | #fc3d21 / #ff8a73 | target side, not-met states |
| --warn | #f2b544 | soft limits only |
| --hatch | grey 135° stripes | unknown: never a pass |

## Type
D-DIN (OFL) for everything, tabular figures. Display 40–76 px at −0.03em; UI labels uppercase 12–13 px tracked 0.08em.

## Motion
One authored moment: the Moon's orbit and the site→target tether on the homepage. UI motion ≤ 300 ms with
`--ease-out` (0.23,1,0.32,1); globe turns `--ease-io`. Press feedback scale(0.97). Reduced motion stops the orbit,
tether cycling and smooth scrolling.

## Rules
- Status = icon + word + colour. Unknown = hatch + "?".
- Real units next to every score ("6.7° vs 6.0°"), never a bare similarity.
- Compare: same patch size, sampling, colour domain and exaggeration on both sides.
- Every site view states what Earth cannot reproduce and the lab test to pair.
