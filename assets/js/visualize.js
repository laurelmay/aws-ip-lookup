import { getIpData } from './data-store.js';
import { CidrTrie, IpVersion, parseCidr } from './ip-address.js';
import { SERVICE_COLORS, SERVICE_NAMES } from './constants.js';

const hexToRgb = (hex) => {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
};

const BG_RGB = hexToRgb('#FAFAFE');
const CELL_TINT_MIN = 0.025;

const CELL_PX = 64;
const CELLS_PER_ROW = 16;
const MAX_DRILL_MASK = { v4: 32, v6: 128 };
const STATE_ENCODER = new TextEncoder();
const STATE_DECODER = new TextDecoder("utf-8");
const IPV4_MAX_VALUE = (1n << 32n) - 1n;
const IPV6_MAX_VALUE = (1n << 128n) - 1n;

const state = { version: 'v4', path: [] };
let currentDrillState = null;

const stateJsonReplacer = (key, value) => {
  if (key === 'path') {
    if (!Array.isArray(value)) {
      return value;
    }
    if (value.some(({addr, mask}) => typeof(addr) !== 'bigint' || typeof(mask) !== 'number')) {
      return value;
    }
    return value
      // This is an imperfect way to detect but it's good enough for the currently-assigned
      // values of IPv6 addresses used in the ip-ranges.json file.
      .map(({ addr, mask }) => formatCidr(addr, mask, addr >= IPV4_MAX_VALUE ? IpVersion.IPV6 : IpVersion.IPV4));
  }
  return value;
};
const stateJsonReviver = (key, value) => {
  if (key === 'path') {
    if (!Array.isArray(value)) {
      return value;
    }
    if (value.some((s) => typeof(s) !== 'string')) {
      return value;
    }
    return value
      .map((s) => parseCidr(s.includes(':') ? IpVersion.IPV6 : IpVersion.IPV4, s))
      .map(({address, mask}) => ({ addr: address, mask }));
  }
  return value;
};

const filterServices = (serviceMasks) => {
  const nonAmazon = new Map([...serviceMasks].filter(([s]) => s !== 'AMAZON'));
  if (nonAmazon.size === 0) {
    return [...serviceMasks.keys()].toSorted();
  }
  const maxNonAmazonMask = Math.max(...nonAmazon.values());
  const visible = [...nonAmazon.keys()];
  const amazonMask = serviceMasks.get('AMAZON');
  if (amazonMask !== undefined && amazonMask > maxNonAmazonMask) {
    visible.push('AMAZON');
  }
  return visible.toSorted();
};

const resolveService = (serviceMasks) => {
  if (serviceMasks.size === 0) {
    return null;
  }
  const visible = filterServices(serviceMasks);
  if (visible.length === 0) {
    return null;
  }
  if (visible.length === 1) {
    return visible[0];
  }
  return 'MULTIPLE';
};

const serviceRgb = (name) => {
  return hexToRgb(SERVICE_COLORS.get(name) ?? '#AAAAAA');
};

const blendRgb = (colors) => {
  const n = colors.length;
  return [0, 1, 2].map((ch) => Math.round(colors.reduce((sum, c) => sum + c[ch], 0) / n));
};

const darken = ([r, g, b], by = 0.15) => [r, g, b].map((c) => Math.round(c * (1 - by)));

const borderRgb = (name) => {
  return name ? darken(serviceRgb(name)) : null;
};

const tintTowardBg = (rgb, usagePct) => {
  const t = usagePct === 0 ? 0 : CELL_TINT_MIN + (1 - CELL_TINT_MIN) * usagePct;
  return rgb.map((c, i) => Math.round(BG_RGB[i] + (c - BG_RGB[i]) * t));
};

const mergeRangesAndCount = (ranges) => {
  // Merge overlapping ranges and sum used addresses.
  let used = 0n;
  let mergeStart = ranges[0].start;
  let mergeEnd = ranges[0].end;
  for (let k = 1; k < ranges.length; k++) {
    if (ranges[k].start <= mergeEnd) {
      if (ranges[k].end > mergeEnd) {
        mergeEnd = ranges[k].end;
      }
    } else {
      used += mergeEnd - mergeStart;
      mergeStart = ranges[k].start;
      mergeEnd = ranges[k].end;
    }
  }
  used += mergeEnd - mergeStart;
  return used;
};

const computeUsage = (cellPrefixes, cellAddr, childMask, totalBits) => {
  const cellSize = 1n << BigInt(totalBits - childMask);

  // If any prefix has a mask <= childMask, it fully contains this cell.
  for (const { mask } of cellPrefixes) {
    if (mask <= childMask) {
      return 1;
    }
  }

  if (cellPrefixes.length === 0) {
    return 0;
  }

  // Build [start, end) intervals as offsets from the start of this cell.
  const intervals = cellPrefixes.map(({ address, mask }) => {
    const start = address - cellAddr;
    const end = start + (1n << BigInt(totalBits - mask));
    return { start, end };
  });

  intervals.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  const used = mergeRangesAndCount(intervals);

  // Multiply before dividing to preserve precision; result is a fraction 0..1.
  return Number((used * 100000n) / cellSize) / 100000;
};

const computeDrillGrid = (trie, baseAddr, baseMask, version) => {
  const totalBits = version === IpVersion.IPV4 ? 32 : 128;
  const childMask = baseMask + 8;

  const relevant = [];
  for (const entry of trie.entries()) {
    if (baseMask === 0) {
      relevant.push(entry);
    } else {
      const sharedBits = Math.min(entry.mask, baseMask);
      const shift = BigInt(totalBits - sharedBits);
      if (entry.address >> shift === baseAddr >> shift) {
        relevant.push(entry);
      }
    }
  }

  return Array.from({ length: CELLS_PER_ROW * CELLS_PER_ROW }, (_, i) => {
    const cellAddr = baseAddr | (BigInt(i) << BigInt(totalBits - childMask));
    const serviceMasks = new Map();
    const serviceRegions = new Map();
    const cellPrefixes = [];
    let hasSubPrefixes = false;
    for (const { address, mask, data } of relevant) {
      const sharedBits = Math.min(mask, childMask);
      const shift = BigInt(totalBits - sharedBits);
      if (address >> shift === cellAddr >> shift) {
        cellPrefixes.push({ address, mask });
        data.forEach((d) => {
          serviceMasks.set(d.service, Math.max(serviceMasks.get(d.service) ?? 0, mask));
          if (!serviceRegions.has(d.service)) {
            serviceRegions.set(d.service, new Set());
          }
          if (d.region) {
            serviceRegions.get(d.service).add(d.region);
          }
        });
        if (mask > childMask) {
          hasSubPrefixes = true;
        }
      }
    }
    const usagePct = computeUsage(cellPrefixes, cellAddr, childMask, totalBits);
    return { serviceMasks, serviceRegions, usagePct, isTerminal: !hasSubPrefixes };
  });
};

const formatIPv4 = (address, mask) => {
  const octet = (sh) => Number((address >> BigInt(sh)) & 0xffn);
  return `${octet(24)}.${octet(16)}.${octet(8)}.${octet(0)}/${mask}`;
};

const formatIPv6 = (address, mask) => {
  const hex = address.toString(16).padStart(32, '0');
  const groups = Array.from({ length: 8 }, (_, i) =>
    parseInt(hex.slice(i * 4, i * 4 + 4), 16).toString(16),
  );

  const longest = { start: -1, length: 0 };
  const current = { start: -1, length: 0 };
  const updateLongest = () => {
    if (current.length > longest.length) {
      longest.length = current.length;
      longest.start = current.start;
    }
    current.start = -1;
    current.length = 0;
  };

  for (const [index, item] of groups.entries()) {
    if (index < groups.length && item === '0') {
      if (current.start === -1) {
        current.start = index;
        current.length = 0;
      }
      current.length += 1;
    } else {
      updateLongest();
    }
  }
  updateLongest();

  if (longest.length > 1) {
    groups.splice(longest.start, longest.length, '');
    if (longest.start === 0) {
      groups.unshift('');
    }
    if (longest.start + longest.length === 8) {
      groups.push('');
    }
  }
  return `${groups.join(':')}/${mask}`;
};

const childCidr = (baseAddr, baseMask, cellIndex, version) => {
  const totalBits = version === IpVersion.IPV4 ? 32 : 128;
  const childMask = baseMask + 8;
  const addr = baseAddr | (BigInt(cellIndex) << BigInt(totalBits - childMask));
  return { addr, mask: childMask };
};

const formatCidr = (addr, mask, version) => {
  return version === IpVersion.IPV4 ? formatIPv4(addr, mask) : formatIPv6(addr, mask);
};

const hasRightNeighbor = (dx, col) => dx === 0 && col > 0;
const hasLeftNeighbor = (dx, col) => dx === CELL_PX - 1 && col < CELLS_PER_ROW - 1;
const hasTopNeighbor = (dy, row) => dy === 0 && row > 0;
const hasBottomNeighbor = (dy, row) => dy === CELL_PX - 1 && row < CELLS_PER_ROW - 1;

const isAtCanvasEdge = (dx, dy, col, row) => {
  return (
    // Check whether we're at the actual canvas edge (with an extra inner px in that case)
    (col === 0 && dx < 2) ||
    (col === CELLS_PER_ROW - 1 && dx >= CELL_PX - 2) ||
    (row === 0 && dy < 2) ||
    (row === CELLS_PER_ROW - 1 && dy >= CELL_PX - 2)
  );
};

const isAtCellEdge = (dx, dy) => dx === 0 || dx === CELL_PX - 1 || dy === 0 || dy === CELL_PX - 1;

const createPxPainter = (cells, i, col, row, resolved) => {
  const name = resolved[i];
  const isBlankCell = !name;
  const fill = !isBlankCell ? tintTowardBg(serviceRgb(name), cells[i].usagePct) : BG_RGB;
  const border = !isBlankCell ? darken(serviceRgb(name)) : fill;

  if (!isBlankCell) {
    return (dx, dy) => {
      const onEdge = isAtCellEdge(dx, dy) || isAtCanvasEdge(dx, dy, col, row);
      return onEdge ? border : fill;
    };
  }

  // Empty cell: instead of drawing its own border, we "bleed" the border color
  // of any adjacent colored cell into this cell's edge pixels. This keeps borders
  // visually consistent between cells. In corners, we "blend" the adjacent cells
  // to avoid any particular neighbor "winning" (the blending is fairly useless
  // for laterally adjacent neighbors, but sharing the code path keeps the code
  // cleaner).
  return (dx, dy) => {
    const colors = [];
    const addColor = (c) => {
      if (c) {
        colors.push(c);
      }
    };

    // Check for direct neighbors
    if (hasRightNeighbor(dx, col)) {
      addColor(borderRgb(resolved[i - 1]));
    }
    if (hasLeftNeighbor(dx, col)) {
      addColor(borderRgb(resolved[i + 1]));
    }
    if (hasTopNeighbor(dy, row)) {
      addColor(borderRgb(resolved[i - CELLS_PER_ROW]));
    }
    if (hasBottomNeighbor(dy, row)) {
      addColor(borderRgb(resolved[i + CELLS_PER_ROW]));
    }

    // And for the corners
    if (hasRightNeighbor(dx, col) && hasTopNeighbor(dy, row)) {
      addColor(borderRgb(resolved[i - CELLS_PER_ROW - 1]));
    }
    if (hasLeftNeighbor(dx, col) && hasTopNeighbor(dy, row)) {
      addColor(borderRgb(resolved[i - CELLS_PER_ROW + 1]));
    }
    if (hasRightNeighbor(dx, col) && hasBottomNeighbor(dy, row)) {
      addColor(borderRgb(resolved[i + CELLS_PER_ROW - 1]));
    }
    if (hasLeftNeighbor(dx, col) && hasBottomNeighbor(dy, row)) {
      addColor(borderRgb(resolved[i + CELLS_PER_ROW + 1]));
    }

    // If there are any items in the list of colors, use
    // those
    if (colors.length === 1) {
      return colors[0];
    }
    if (colors.length > 1) {
      return blendRgb(colors);
    }

    // If on the border of the cell (or canvas) with no relevant
    // neighbors, then use a very light fill
    if (isAtCanvasEdge(dx, dy, col, row) || isAtCellEdge(dx, dy)) {
      return darken(fill, 0.025);
    }

    // Finally, fall back to the default fill
    return fill;
  };
};

const renderDrillCanvas = (cells, canvas) => {
  const SIZE = CELLS_PER_ROW * CELL_PX;
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(SIZE, SIZE);
  const resolved = cells.map((c) => resolveService(c.serviceMasks));
  for (let i = 0; i < CELLS_PER_ROW * CELLS_PER_ROW; i++) {
    const col = i % CELLS_PER_ROW;
    const row = Math.floor(i / CELLS_PER_ROW);
    const paint = createPxPainter(cells, i, col, row, resolved);
    for (let dx = 0; dx < CELL_PX; dx++) {
      for (let dy = 0; dy < CELL_PX; dy++) {
        const [r, g, b] = paint(dx, dy);
        const idx = ((row * CELL_PX + dy) * SIZE + (col * CELL_PX + dx)) * 4;
        img.data[idx] = r;
        img.data[idx + 1] = g;
        img.data[idx + 2] = b;
        img.data[idx + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
};

const buildLegend = (cells, legendEl) => {
  const present = cells
    .map(({ serviceMasks }) => resolveService(serviceMasks))
    .reduce((acc, r) => acc.add(r), new Set());

  legendEl.replaceChildren();
  for (const [name, color] of SERVICE_COLORS.entries()) {
    if (!present.has(name)) {
      continue;
    }
    const item = document.createElement('div');
    item.className = 'legend-item';
    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.style.backgroundColor = color;
    if (name === 'MULTIPLE') {
      swatch.style.border = '1px solid #aaa';
    }
    const label = document.createElement('span');
    label.textContent =
      name === 'MULTIPLE' ? 'Multiple services' : (SERVICE_NAMES.get(name) ?? name);
    item.append(swatch, label);
    legendEl.appendChild(item);
  }
  if (present.size > 0) {
    const item = document.createElement('div');
    item.className = 'legend-item';
    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.style.background = `rgb(${BG_RGB.join(',')})`;
    swatch.style.border = '1px solid #555';
    const label = document.createElement('span');
    label.textContent = 'No AWS usage';
    item.append(swatch, label);
    legendEl.appendChild(item);
  }
  const legendNote = document.createElement('div');
  legendNote.className = 'legend-item';
  legendNote.style.flexBasis = '100%';
  const noteText = document.createElement('span');
  noteText.textContent = 'Lighter color cells indicate fewer IP addresses in-use by AWS';
  legendNote.appendChild(noteText);
  legendEl.appendChild(legendNote);
};

const showTooltip = (
  tooltip,
  cidrText,
  serviceMasks,
  serviceRegions,
  usagePct,
  clientX,
  clientY,
) => {
  const visible = filterServices(serviceMasks);
  const serviceNames = visible.map((name) => SERVICE_NAMES.get(name) ?? name);
  const serviceText = !serviceNames.length
    ? 'No AWS usage'
    : serviceNames.length <= 4
      ? serviceNames.join(', ')
      : `${serviceNames.length} services`;

  const regionSet = visible
    .flatMap((service) => [...serviceRegions.get(service)])
    .filter((region) => !!region)
    .reduce((acc, region) => acc.add(region), new Set());
  const regions = [...regionSet].toSorted();
  const regionText = !regions.length
    ? ''
    : regions.length <= 4
      ? regions.join(', ')
      : `${regions.length} regions`;

  tooltip.querySelector('.tooltip-prefix').textContent = cidrText;
  tooltip.querySelector('.tooltip-services').textContent = serviceText;
  const regionEl = tooltip.querySelector('.tooltip-region');
  regionEl.textContent = regionText;
  regionEl.style.display = regionText ? '' : 'none';

  const usageEl = tooltip.querySelector('.tooltip-usage');
  if (usagePct) {
    let pct = (usagePct * 100).toFixed(1).replace(/\.0$/, '');
    if (pct === '0') {
      pct = '<0.1';
    }
    usageEl.textContent = `${pct}% of block in-use by AWS`;
    usageEl.style.display = '';
  } else {
    usageEl.style.display = 'none';
  }

  const tipX = clientX + 14;
  tooltip.style.left =
    (tipX + tooltip.offsetWidth + 16 > window.innerWidth
      ? clientX - tooltip.offsetWidth - 10
      : tipX) + 'px';
  tooltip.style.top = clientY + 14 + 'px';
  tooltip.style.display = 'block';
};

const renderBreadcrumb = (el) => {
  el.replaceChildren();

  const crumb = (text, mono, onClick) => {
    const span = document.createElement('span');
    span.className =
      'breadcrumb-item' + (mono ? ' monospaced' : '') + (onClick ? ' breadcrumb-link' : '');
    span.textContent = text;
    if (onClick) {
      span.addEventListener('click', onClick);
    }
    return span;
  };

  const sep = () => {
    const span = document.createElement('span');
    span.className = 'breadcrumb-sep';
    span.textContent = ' ▸ ';
    return span;
  };

  if (!state.path.length) {
    return;
  }

  const rootLabel = state.version === 'v4' ? 'All IPv4' : 'All IPv6';
  el.appendChild(
    crumb(rootLabel, false, () => {
      state.path = [];
      pushStateToUrl();
      render();
    }),
  );

  const fmt = state.version === 'v4' ? formatIPv4 : formatIPv6;
  state.path.forEach(({ addr, mask }, i) => {
    const isLast = i === state.path.length - 1;
    el.append(
      sep(),
      isLast
        ? crumb(fmt(addr, mask), true, null)
        : crumb(fmt(addr, mask), true, () => {
            state.path = state.path.slice(0, i + 1);
            pushStateToUrl();
            render();
          }),
    );
  });
};

const pushStateToUrl = () => {
  try {
    const dataArray = STATE_ENCODER.encode(JSON.stringify(state, stateJsonReplacer));
    const stateStr = dataArray.toBase64({ alphabet: 'base64url', omitPadding: true });
    const newUrl = new URL(window.location);
    newUrl.search = new URLSearchParams({ state: stateStr }).toString();
    window.history.pushState({ path: newUrl.toString() }, '', newUrl.toString());
  } catch (err) {
    console.error("Failed to push state to URL", e);
    // Just overwrite to remove the state tracking
    const newUrl = new URL(window.location);
    newUrl.search = undefined;
    window.history.pushState(newUrl.toString(), '', newUrl.toString());
  }
};

const assertStateValid = (candidateState) => {
  const { version, path } = candidateState;
  if (!['v4','v6'].includes(version)) {
    throw new Error(`Invalid version: ${version}`);
  }
  if (!Array.isArray(path)) {
    throw new Error(`State path is not an array`);
  }
  if (path.length >= MAX_DRILL_MASK[version] / 8) {
    throw new Error(`Path too long: ${path.length}`);
  }
  let prev = undefined;
  for (const [idx, cidr] of path.entries()) {
    const expectedMask = (idx + 1) * 8;
    if (typeof(cidr.addr) !== 'bigint' || typeof(cidr.mask) !== 'number') {
      throw new Error(`Invalid data types [${typeof(cidr.addr)}, ${typeof(cidr.mask)}`);
    }
    if (cidr.mask % 8 !== 0 || cidr.mask === 0) {
      throw new Error(`Invalid mask: ${cidr.mask}`);
    }
    if (cidr.mask !== expectedMask) {
      throw new Error(`Invalid mask (out of order?): ${cidr.mask}@${idx}`);
    }
    if (cidr.mask >= MAX_DRILL_MASK[version]) {
      throw new Error(`Invalid mask: ${cidr.mask}`);
    }
    if (version === 'v4') {
      if (cidr.addr > IPV4_MAX_VALUE) {
        throw new Error(`Invalid addr: ${cidr.addr}`);
      }
    }
    if (version === 'v6') {
      // This is an imperfect check but it's good enough for the IPv6 addresses
      // currently assigned to AWS (and that's likely to be the case for the
      // foreseeable future).
      if (cidr.addr < IPV4_MAX_VALUE || cidr.addr > IPV6_MAX_VALUE) {
        throw new Error(`Invalid addr: ${cidr.addr}`);
      }
    }
    const totalBits = version === 'v4' ? 32n : 128n;
    const hostBits = BigInt(totalBits - BigInt(cidr.mask));
    if (hostBits > 0n && (cidr.addr & ((1n << hostBits) - 1n)) !== 0n) {
      throw new Error(`Unaligned addr for /${cidr.mask}: ${cidr.addr}`);
    }
    if (prev) {
      const shift = totalBits - BigInt(prev.mask);
      if ((cidr.addr >> shift) !== (prev.addr >> shift)) {
        throw new Error(`Path element ${idx} is not contained within its parent`);
      }
    }
    prev = cidr;
  }
};

const loadStateFromUrl = () => {
  try {
    const urlStateRaw = new URL(window.location).searchParams.get('state');
    if (urlStateRaw) {
      if (urlStateRaw.length > 1024) {
        throw new Error('State too large');
      }
      const dataArray = Uint8Array.fromBase64(urlStateRaw, { alphabet: 'base64url', lastChunkHandling: 'loose'});
      const jsonData = STATE_DECODER.decode(dataArray);
      const urlState = JSON.parse(jsonData, stateJsonReviver);
      assertStateValid(urlState);
      state.path = urlState.path;
      state.version = urlState.version;
    } else {
      state.path = [];
      state.version = 'v4';
    }
  } catch (err) {
    console.error("Failed to parse state", err);
    state.path = [];
    state.version = 'v4';
  }
};

const render = () => {
  const canvas = document.getElementById('drill-map');
  const legend = document.getElementById('legend');
  const crumbEl = document.getElementById('breadcrumb');
  const tooltip = document.getElementById('map-tooltip');
  tooltip.style.display = 'none';

  renderBreadcrumb(crumbEl);

  const version = state.version === 'v4' ? IpVersion.IPV4 : IpVersion.IPV6;
  const trie = version === IpVersion.IPV4 ? v4Trie : v6Trie;
  const top = state.path[state.path.length - 1];
  const baseAddr = top ? top.addr : 0n;
  const baseMask = top ? top.mask : 0;
  const maxDrillMask = MAX_DRILL_MASK[state.version];

  const cells = computeDrillGrid(trie, baseAddr, baseMask, version);
  renderDrillCanvas(cells, canvas);
  buildLegend(cells, legend);

  currentDrillState = { cells, baseAddr, baseMask, version, maxDrillMask };
};

const getCellIndexInCanvas = (canvas, clientX, clientY) => {
  if (!currentDrillState) {
    return undefined;
  }
  const rect = canvas.getBoundingClientRect();
  const col = Math.floor(((clientX - rect.left) * canvas.width) / rect.width / CELL_PX);
  const row = Math.floor(((clientY - rect.top) * canvas.height) / rect.height / CELL_PX);
  if (col < 0 || col >= CELLS_PER_ROW || row < 0 || row >= CELLS_PER_ROW) {
    return undefined;
  }
  const { cells, baseAddr, baseMask, version } = currentDrillState;
  const i = row * CELLS_PER_ROW + col;
  const cell = cells[i];
  return { cell, cidr: childCidr(baseAddr, baseMask, i, version) };
};

const setupInteractions = () => {
  const canvas = document.getElementById('drill-map');
  const tooltip = document.getElementById('map-tooltip');

  canvas.addEventListener('mousemove', (e) => {
    const cellData = getCellIndexInCanvas(canvas, e.clientX, e.clientY);
    if (!cellData) {
      return;
    }

    const {
      cell,
      cidr: { addr, mask },
    } = cellData;

    const { version, maxDrillMask } = currentDrillState;
    showTooltip(
      tooltip,
      formatCidr(addr, mask, version),
      cell.serviceMasks,
      cell.serviceRegions,
      mask < maxDrillMask ? cell.usagePct : null,
      e.clientX,
      e.clientY,
    );
  });

  canvas.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
  });

  canvas.addEventListener('click', (e) => {
    const cellData = getCellIndexInCanvas(canvas, e.clientX, e.clientY);
    if (!cellData) {
      return;
    }

    const {
      cell,
      cidr: { addr, mask },
    } = cellData;
    if (!resolveService(cell.serviceMasks)) {
      return;
    }
    const { version, maxDrillMask } = currentDrillState;

    if (mask >= maxDrillMask || cell.isTerminal) {
      window.location.href = `/?lookup=${encodeURIComponent(formatCidr(addr, mask, version))}`;
    } else {
      state.path.push({ addr, mask });
      pushStateToUrl();
      render();
    }
  });
};

const setupTabs = () => {
  document.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.version = btn.dataset.tab;
      state.path = [];
      document
        .querySelectorAll('[data-tab]')
        .forEach((b) => b.classList.toggle('tab-active', b === btn));
      pushStateToUrl();
      render();
    });
    if (btn.dataset.tab === state.version) {
      btn.classList.add('tab-active');
    } else {
      btn.classList.remove('tab-active');
    }
  });
};

const v4Trie = new CidrTrie(IpVersion.IPV4);
const v6Trie = new CidrTrie(IpVersion.IPV6);

(async () => {
  const loading = document.getElementById('loading');
  const mapContainer = document.getElementById('map-container');
  const errorContainer = document.getElementById('error-container');

  try {
    const ipData = await getIpData();
    ipData['prefixes'].forEach((prefix) => v4Trie.add(prefix, 'ip_prefix'));
    ipData['ipv6_prefixes'].forEach((prefix) => v6Trie.add(prefix, 'ipv6_prefix'));

    setupInteractions();
    loadStateFromUrl();
    setupTabs();
    render();

    loading.style.display = 'none';
    mapContainer.style.display = 'block';
  } catch (err) {
    loading.style.display = 'none';
    errorContainer.querySelector('.error-message').textContent = err.toString();
    errorContainer.style.display = 'block';
    console.error(err);
  }
})();

window.addEventListener('popstate', () => {
  loadStateFromUrl();
  render();
});
