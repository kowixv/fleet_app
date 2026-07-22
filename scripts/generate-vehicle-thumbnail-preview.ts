import fs from "node:fs/promises";
import path from "node:path";
import { VEHICLE_PHOTO_ASSETS } from "../lib/vehicle-thumbnail-assets";
import { getVehicleThumbnailColors } from "../lib/vehicle-thumbnail";

const colors = ["white", "black", "blue", "red", "yellow", "silver", "dark blue", "green"];
const sizes = [
  { label: "100 x 62", width: 100, height: 62 },
  { label: "180 x 112", width: 180, height: 112 },
];

async function main() {
  const rows = Object.entries(VEHICLE_PHOTO_ASSETS).map(([variant, asset]) => ({ variant, asset }));
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Vehicle Thumbnail Preview</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 24px; color: #0f172a; background: #f8fafc; }
    h1 { font-size: 20px; margin: 0 0 16px; }
    h2 { font-size: 15px; margin: 24px 0 10px; }
    table { border-collapse: collapse; background: white; box-shadow: 0 1px 4px rgb(15 23 42 / 0.08); }
    th, td { border: 1px solid #e2e8f0; padding: 8px; font-size: 12px; vertical-align: top; }
    th { background: #f1f5f9; text-align: left; }
    .thumb { position: relative; isolation: isolate; overflow: hidden; border: 1px solid #cbd5e1; border-radius: 6px; background: #f8fafc; }
    .thumb img, .thumb .paint, .thumb .tone { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; object-position: center; }
    .paint, .tone {
      -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
      -webkit-mask-size: contain; mask-size: contain;
      -webkit-mask-position: center; mask-position: center;
      pointer-events: none;
    }
    .paint { mix-blend-mode: color; }
  </style>
</head>
<body>
  <h1>Vehicle Thumbnail Preview</h1>
  ${sizes.map((size) => `
    <h2>${size.label}</h2>
    <table>
      <thead><tr><th>Vehicle</th>${colors.map((color) => `<th>${color}</th>`).join("")}</tr></thead>
      <tbody>
        ${rows.map(({ variant, asset }) => `
          <tr>
            <th>${variant}</th>
            ${colors.map((color) => {
              const resolved = getVehicleThumbnailColors(color).bodyColor;
              return `<td><div class="thumb" style="width:${size.width}px;height:${size.height}px">
                <img src="..${asset.baseSrc}" alt="" />
                <div class="paint" style="background:${resolved};-webkit-mask-image:url('..${asset.maskSrc}');mask-image:url('..${asset.maskSrc}')"></div>
                <div class="tone" style="background:${resolved};opacity:${color === "black" ? "0.25" : color === "white" ? "0.22" : "0.12"};mix-blend-mode:${color === "white" ? "screen" : "multiply"};-webkit-mask-image:url('..${asset.maskSrc}');mask-image:url('..${asset.maskSrc}')"></div>
              </div></td>`;
            }).join("")}
          </tr>
        `).join("")}
      </tbody>
    </table>
  `).join("")}
</body>
</html>`;

  const outputPath = path.join(process.cwd(), "tmp", "vehicle-thumbnail-preview.html");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, html, "utf8");
  console.log(outputPath);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
