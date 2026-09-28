import fs from 'node:fs';

const files = {
  DAY_CLEAR: 'src/assets/environment/hdri/day-clear/qwantani_noon_puresky_2k.hdr',
  DAY_OVERCAST: 'src/assets/environment/hdri/day-overcast/overcast_soil_2_2k.hdr',
  SUNRISE: 'src/assets/environment/hdri/sunrise/kiara_1_dawn_2k.hdr',
  SUNSET: 'src/assets/environment/hdri/sunset/sunset_fairway_2k.hdr',
  NIGHT: 'src/assets/environment/hdri/night/rogland_clear_night_2k.hdr',
};

function readRadianceHdr(path) {
  const bytes = fs.readFileSync(path);
  let offset = 0;
  const readLine = () => {
    const end = bytes.indexOf(10, offset);
    const line = bytes.toString('ascii', offset, end).trim();
    offset = end + 1;
    return line;
  };
  while (readLine() !== '') { /* HDR header */ }
  const dimensions = readLine().match(/-Y (\d+) \+X (\d+)/);
  if (!dimensions) throw new Error(`Unsupported HDR orientation: ${path}`);
  const height = Number(dimensions[1]);
  const width = Number(dimensions[2]);
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    if (bytes[offset++] !== 2 || bytes[offset++] !== 2 ||
        ((bytes[offset++] << 8) | bytes[offset++]) !== width) {
      throw new Error(`Invalid RGBE scanline ${y}: ${path}`);
    }
    for (let channel = 0; channel < 4; channel++) {
      let x = 0;
      while (x < width) {
        const run = bytes[offset++];
        if (run > 128) {
          const value = bytes[offset++];
          for (let n = 0; n < run - 128; n++) pixels[(y * width + x++) * 4 + channel] = value;
        } else {
          for (let n = 0; n < run; n++) pixels[(y * width + x++) * 4 + channel] = bytes[offset++];
        }
      }
    }
  }
  return { width, height, pixels };
}

function projectDiffuse(path) {
  const { width, height, pixels } = readRadianceHdr(path);
  const coefficients = Array.from({ length: 9 }, () => [0, 0, 0]);
  let totalWeight = 0;
  // Four-pixel integration stride captures broad diffuse lighting without chasing tiny sun pixels.
  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      const theta = Math.PI * (y + .5) / height;
      const phi = 2 * Math.PI * (x + .5) / width;
      const nx = Math.sin(theta) * Math.cos(phi);
      const ny = Math.sin(theta) * Math.sin(phi);
      const nz = Math.cos(theta);
      const basis = [.282095, .488603 * ny, .488603 * nz, .488603 * nx,
        1.092548 * nx * ny, 1.092548 * ny * nz, .315392 * (3 * nz * nz - 1),
        1.092548 * nx * nz, .546274 * (nx * nx - ny * ny)];
      const pixel = (y * width + x) * 4;
      const exponent = pixels[pixel + 3];
      if (!exponent) continue;
      const scale = 2 ** (exponent - 136);
      const weight = Math.sin(theta);
      totalWeight += weight;
      for (let k = 0; k < 9; k++) {
        for (let channel = 0; channel < 3; channel++) {
          coefficients[k][channel] += pixels[pixel + channel] * scale * weight * basis[k];
        }
      }
    }
  }
  return coefficients.map(row => row.map(value =>
    Number((value / totalWeight * 4 * Math.PI).toFixed(5))));
}

const coefficients = Object.fromEntries(Object.entries(files).map(([name, path]) =>
  [name, projectDiffuse(path)]));
fs.writeFileSync('src/scenes/advanced/environmentHdriCoefficients.json',
  `${JSON.stringify(coefficients, null, 2)}\n`);
