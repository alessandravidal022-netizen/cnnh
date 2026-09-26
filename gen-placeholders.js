const fs = require('fs');
const path = require('path');
const outDir = path.join(__dirname, 'img');
const states = {
  AP: { color: '#0066CC', label: 'DETRAN AP' },
  PE: { color: '#FF6600', label: 'DETRAN PE' },
  TO: { color: '#FFCC00', label: 'DETRAN TO' },
  RS: { color: '#009966', label: 'DETRAN RS' }
};
for (const [uf, cfg] of Object.entries(states)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><rect width="200" height="80" fill="${cfg.color}" rx="8"/><text x="100" y="50" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" font-weight="bold" fill="white">${cfg.label}</text></svg>`;
  const outFile = path.join(outDir, `detran-${uf.toLowerCase()}.png`);
  // Write as SVG file but with .png extension won't work in browsers expecting PNG
  // Instead write as .svg and we'll reference them as SVG in the bundle
  const svgFile = path.join(outDir, `detran-${uf.toLowerCase()}.svg`);
  fs.writeFileSync(svgFile, svg, 'utf8');
  console.log(`OK: ${svgFile} (${fs.statSync(svgFile).size} bytes)`);
}
console.log('DONE');