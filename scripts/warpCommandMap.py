from math import atan, exp, log, pi, tan
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
source_path = ROOT / 'src/assets/map/command-map-unwarped.png'
output_path = ROOT / 'src/assets/map/command-map.png'
NORTH, SOUTH, WEST, EAST = 52.7, 44.1, 21.5, 40.7

def mercator_y(latitude):
    return log(tan(pi / 4 + latitude * pi / 360))

def inverse_mercator(value):
    return (2 * atan(exp(value)) - pi / 2) * 180 / pi

source = Image.open(source_path).convert('RGBA')
north_y, south_y = mercator_y(NORTH), mercator_y(SOUTH)
mercator_height_degrees = (north_y - south_y) * 180 / pi
output_height = round(source.width / ((EAST - WEST) / mercator_height_degrees))
output = Image.new('RGBA', (source.width, output_height))

for output_y in range(output_height):
    amount = output_y / max(1, output_height - 1)
    latitude = inverse_mercator(north_y + (south_y - north_y) * amount)
    source_y = round(((NORTH - latitude) / (NORTH - SOUTH)) * (source.height - 1))
    source_y = max(0, min(source.height - 1, source_y))
    output.paste(source.crop((0, source_y, source.width, source_y + 1)), (0, output_y))

output.save(output_path)
source_path.unlink(missing_ok=True)
