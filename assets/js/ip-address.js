export const IpVersion = Object.freeze({
  IPV4: 4,
  IPV6: 6,
});

const v4OctetRegex = '(?:[0-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-5])';
const v4AddressRegex = `(?:${v4OctetRegex}\\.){3,3}${v4OctetRegex}`;
const v4CidrRegex = new RegExp(`^(?:${v4AddressRegex})(?:\\/(?:[0-9]|[1-2][0-9]|3[0-2]))?$`);
const v6SegmentRegex = '[0-9a-fA-F]{1,4}';
// While there are certain IPv6 address constructs outside this regex
// (specifically link-local and addresses that contain v4 addresses),
// those are unlikely to be relevant in the case of looking up AWS-hosted
// IP addresses.
const v6AddressRegex =
  '(' +
  `(?:${v6SegmentRegex}:){7,7}${v6SegmentRegex}|` +
  `(?:${v6SegmentRegex}:){1,7}:|` +
  `(?:${v6SegmentRegex}:){1,6}:${v6SegmentRegex}|` +
  `(?:${v6SegmentRegex}:){1,5}(?::${v6SegmentRegex}){1,2}|` +
  `(?:${v6SegmentRegex}:){1,4}(?::${v6SegmentRegex}){1,3}|` +
  `(?:${v6SegmentRegex}:){1,3}(?::${v6SegmentRegex}){1,5}|` +
  `${v6SegmentRegex}:(?::${v6SegmentRegex}){1,6}` +
  ')';
const v6CidrRegex = new RegExp(
  `^(?:${v6AddressRegex})(?:\\/(?:[0-9]|[1-9][0-9]|1[0-1][0-9]|12[0-8]))?$`,
);

function isIpv4Address(address) {
  return v4CidrRegex.test(address);
}

function ipV4AddressToNumber(address) {
  const octets = address.split('.').map((octet) => BigInt(parseInt(octet, 10)));
  return (octets[0] << 24n) | (octets[1] << 16n) | (octets[2] << 8n) | octets[3];
}

function isIpv6Address(address) {
  return v6CidrRegex.test(address);
}

export function ipAddressVersion(address) {
  if (isIpv4Address(address)) {
    return IpVersion.IPV4;
  }
  if (isIpv6Address(address)) {
    return IpVersion.IPV6;
  }
  return undefined;
}

function ipV6AddressToNumber(address) {
  let segments = address.split(':');

  // Insert empty segments in place of `::` until there are
  // exactly 8 segments total.
  const emptySegment = segments.indexOf('');
  if (emptySegment !== -1) {
    while (segments.length < 8) {
      segments.splice(emptySegment, 0, '');
    }
  }

  // 0-pad all segments to 4 "digits" to ensure that they are
  // properly padded for the hex representation
  const paddedParts = segments.map((segment) => segment.padStart(4, '0'));
  return BigInt(`0x${paddedParts.join('')}`);
}

export function parseCidr(version, cidr) {
  const [address, mask] = cidr.split('/');
  if (mask !== undefined && !/^\d{1,3}$/.test(mask)) {
    throw new Error(`Invalid mask ${mask}`);
  }
  if (version === IpVersion.IPV4) {
    if (!isIpv4Address(address)) {
      throw new Error(`Invalid IPv4 Address: ${address}`);
    }
    const cidrMask = parseInt(mask ?? 32, 10);
    if (cidrMask > 32) {
      throw new Error(`Invalid IPv4 Mask: ${mask}`);
    }
    return {
      address: ipV4AddressToNumber(address),
      mask: cidrMask,
    };
  }
  if (version === IpVersion.IPV6) {
    if (!isIpv6Address(address)) {
      throw new Error(`Invalid IPv6 Address: ${address}`);
    }
    const cidrMask = parseInt(mask ?? 128, 10);
    if (cidrMask > 128) {
      throw new Error(`Invalid IPv6 Mask: ${mask}`);
    }
    return {
      address: ipV6AddressToNumber(address),
      mask: cidrMask,
    };
  }
}

class TrieNode {
  constructor() {
    this.isTerminal = false;
    this.child0 = null;
    this.child1 = null;
    this.data = new Set();
  }

  addData(data) {
    if (Array.isArray(data)) {
      data.forEach((d) => this.data.add(d));
    } else {
      this.data.add(data);
    }
  }
}

export class CidrTrie {
  constructor(version) {
    if (version !== IpVersion.IPV4 && version !== IpVersion.IPV6) {
      throw new Error('The version must be either IPv4 or IPv6');
    }

    this.version = version;
    this.root = new TrieNode();
  }

  add(prefixData, ipAddressKey) {
    const { [ipAddressKey]: prefix } = prefixData;
    const cidr = parseCidr(this.version, prefix);
    this.#setData(cidr, prefixData);
  }

  lookup(ipAddress) {
    const data = this.#query(parseCidr(this.version, ipAddress));
    return data.map((d) => ({ ...d, ipAddress }));
  }

  #nextBit(address, depth) {
    const bitIndex = (this.version === IpVersion.IPV4 ? 31 : 127) - depth;
    return (address >> BigInt(bitIndex)) & 1n;
  }

  #setData(cidr, data, node = this.root, depth = 0) {
    if (depth === cidr.mask) {
      node.isTerminal = true;
      node.addData(data);
      return;
    }

    if (this.#nextBit(cidr.address, depth) === 0n) {
      node.child0 ??= new TrieNode();
      this.#setData(cidr, data, node.child0, depth + 1);
    } else {
      node.child1 ??= new TrieNode();
      this.#setData(cidr, data, node.child1, depth + 1);
    }
  }

  #query(cidr, node = this.root, depth = 0, data = []) {
    if (node === null || depth === cidr.mask) {
      return node?.isTerminal ? [...data, ...node.data] : data;
    }

    const accumulated = node.isTerminal ? [...data, ...node.data] : data;
    const child = this.#nextBit(cidr.address, depth) === 0n ? node.child0 : node.child1;
    return this.#query(cidr, child, depth + 1, accumulated);
  }

  *entries() {
    yield* this.#walkEntries(this.root, 0n, 0);
  }

  *#walkEntries(node, address, depth) {
    if (node === null) {
      return;
    }
    if (node.isTerminal) {
      yield { address, mask: depth, data: node.data };
    }
    const bitPos = BigInt((this.version === IpVersion.IPV4 ? 31 : 127) - depth);
    if (node.child0) {
      yield* this.#walkEntries(node.child0, address, depth + 1);
    }
    if (node.child1) {
      yield* this.#walkEntries(node.child1, address | (1n << bitPos), depth + 1);
    }
  }
}
