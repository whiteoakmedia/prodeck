import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const copy: [string, string, number][] = [
  [
    "`today · ${clock(ms)}`",
    "`hoy · ${clock(ms)}`",
    1
  ],
  [
    "caption: \"min to service\"",
    "caption: \"min para el evento\"",
    1
  ],
  [
    "caption: \"min into service\"",
    "caption: \"min desde el inicio\"",
    1
  ],
  [
    "big: \"done\", caption: \"service passed\"",
    "big: \"finalizado\", caption: \"el evento ya pasó\"",
    1
  ],
  [
    "caption: \"to service\"",
    "caption: \"para el evento\"",
    2
  ]
];
it("protects src/mobile/fmt.ts outside reviewed presentation", () => {
 let expected = readFileSync("src/__tests__/fixtures/localization/fmt-20261123-baseline.txt", "utf8");
 for (const [from, to, count] of copy) { expect(expected.split(from)).toHaveLength(count + 1); expected = expected.split(from).join(to); }
 expect(readFileSync("src/mobile/fmt.ts", "utf8")).toBe(expected);
});
