# Chrono Trigger Sprite Editor Tools

## Overview
A pair of Node.js utilities for safely extracting, editing, and patching Chrono Trigger sprite data. These tools support direct ROM addressing, CSV-based sprite lookup, strict size preservation, and automated flag-byte restoration.

## Requirements
- Node.js v16 or newer
- Unheadered Chrono Trigger ROM
- CSV reference files:
  - `ChronoTriggerUnheaderedSpriteInfo-indiciees.csv`
  - `ChronoTriggerUnheaderedSpriteInfo-gfx-packs.csv`
- External graphics editor (Tile Molester recommended)

## Installation & Setup
1. Place the following files in a single working directory:
   - `ct_decompress.js`
   - `ct_patch.js`
   - `chrono.rom` (unheadered)
   - Both CSV files listed above
2. Make scripts executable:
   ```bash
   chmod +x ct_decompress.js ct_patch.js
   ```
3. Verify Node.js installation:
   ```bash
   node --version
   ```

## Usage Guide

### Decompression
Extract a compressed sprite packet from the ROM and save it as a raw `.bin` file.

```bash
node ct_decompress.js <target> [rom.rom]
```

**Target formats:**
- Sprite name: `"Naga-Ette"`, `"Prehistoric Villager (Woman, Ioka)"`
- Index: `NPC-31`, `ENEMY-30`
- Hex address: `0x16C77E`, `0x059A56`
- Decimal address: `1468030`

**Examples:**
```bash
node ct_decompress.js "Naga-Ette" chrono.rom
node ct_decompress.js 0x059A56 chrono.rom
node ct_decompress.js NPC-31
```

### Listing Available Sprites
Display all indexed sprites with their GFX packet indices and ROM addresses.

```bash
node ct_decompress.js --list
```

### Patching
Compress edited raw sprite data and patch it back into a new ROM file.

```bash
node ct_patch.js <target> <edited_raw.bin> [input_rom.rom] [output_rom.rom]
```

**Examples:**
```bash
node ct_patch.js "Naga-Ette" naga_edited.bin chrono.rom chrono_patched.rom
node ct_patch.js 0x059A56 overworld_pc_edited.bin chrono.rom chrono_patched.rom
```

## Technical Specifications

### Compression Algorithm
The recompression engine implements the exact LZ77 variant used by Chrono Trigger. It evaluates both 11-bit and 12-bit offset ranges and selects the smaller output. The algorithm matches the Temporal Flux reference implementation, preserving identical control-byte structures, addendum formatting, and stream termination markers.

### Size Preservation
Chrono Trigger uses absolute pointer tables. Expanding a compressed packet will overwrite adjacent ROM data and break subsequent sprites. The patching script:
- Automatically zero-pads smaller outputs to match the original packet size
- Preserves the exact 2-byte size header
- Restores the trailing flag byte (`& 0xC0`) that controls bit-width mode for the next packet
- Aborts with an error if the new data exceeds the original size

### ROM Integrity
- Input ROMs are never modified in place
- Output files are generated via isolated memory allocation to prevent buffer aliasing
- All pointer calculations are validated against ROM boundaries before patching

## Workflow with Tile Molester
1. Decompress the target packet using `ct_decompress.js`
2. Open the `.bin` file in Tile Molester
3. Set codec to `4bpp planar composite 2 by 2 bpp`
4. Import palette from a ZSNES/bsnes savestate (`Palette > Import from > Another file`)
5. Edit sprite data while maintaining exact tile dimensions and frame count
6. Save edited data as a new `.bin` file
7. Patch using `ct_patch.js`

## Credits & Acknowledgments
- Decompression and recompression algorithms reverse-engineered and documented by Michael Springer (Temporal Flux) (http://geigercount.net/crypt/)
- Sprite indexing and pointer data compiled from FaustWolf (https://www.romhacking.net/documents/444/)

## License
MIT
