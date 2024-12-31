export const IpVersion = Object.freeze({
  IPV4: 4,
  IPV6: 6,
});

const v4OctetRegex = '(?:[0-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-5])';
const v4AddressRegex = new RegExp(`^(?:${v4OctetRegex}\\.){3,3}${v4OctetRegex}$`);
const v6SegmentRegex = '[0-9a-fA-F]{1,4}';
// While there are certain IPv6 address constructs outside this regex
// (specifically link-local and addresses that contain v4 addresses),
// those are unlikely to be relevant in the case of looking up AWS-hosted
// IP addresses.
const v6AddressRegex = new RegExp('^(' +
  `(?:${v6SegmentRegex}:){7,7}${v6SegmentRegex}|` +
  `(?:${v6SegmentRegex}:){1,7}:|` +
  `(?:${v6SegmentRegex}:){1,6}:${v6SegmentRegex}|` +
  `(?:${v6SegmentRegex}:){1,5}:(?:${v6SegmentRegex}){1,2}|` +
  `(?:${v6SegmentRegex}:){1,4}:(?:${v6SegmentRegex}){1,3}|` +
  `(?:${v6SegmentRegex}:){1,3}:(?:${v6SegmentRegex}){1,5}|` +
  `${v6SegmentRegex}:(?:(?::${v6SegmentRegex}){1,6})` +
  ')$');

export function isIpv4Address(address) {
  return v4AddressRegex.test(address);
}

function ipV4AddressToNumber(address) {
  const octets = address.split('.').map((octet) => parseInt(octet, 10));
  return BigInt((octets[0] << 24) + (octets[1] << 16) + (octets[2] << 8) + octets[3]);
}

export function isIpv6Address(address) {
  return v6AddressRegex.test(address);
}

function ipV6AddressToNumber(address) {
  let segments = address.split(':');

  // Insert empty segments in place of `::` until there are
  // exactly 8 segments total.
  const emptySegment = segments.indexOf('');
  if (emptySegment != -1) {
    while (segments.length < 8) {
      segments.splice(emptySegment, 0, "");
    }
  }

  // 0-pad all segments to 4 "digits" to ensure that they are
  // properly padded for the hex representation
  const paddedParts = segments.map((segment) => segment.padStart(4, '0'));

  return BigInt(`0x${paddedParts.join('')}`);
}

function parseCidr(version, cidr) {
  const [address, mask] = cidr.split('/');
  if (version === IpVersion.IPV4) {
    return { address: ipV4AddressToNumber(address), mask: parseInt(mask, 10) };
  }
  if (version === IpVersion.IPV6) {
    return { address: ipV6AddressToNumber(address), mask: parseInt(mask, 10) };
  }
}

function parseAddress(version, ipAddress) {
  if (version === IpVersion.IPV4) {
    if (!isIpv4Address(ipAddress)) {
      throw new Error(`Invalid IPv4 Address: ${ipAddress}`);
    }
    return { address: ipV4AddressToNumber(ipAddress), mask: 32 };
  }
  if (version === IpVersion.IPV6) {
    if (!isIpv6Address(ipAddress)) {
      throw new Error(`Invalid IPv6 Address: ${ipAddress}`);
    }
    return { address: ipV6AddressToNumber(ipAddress), mask: 128 };
  }
}

class TrieNode {
  constructor({ isTerminal = false, child0 = null, child1 = null} = {}) {
    this.isTerminal = isTerminal;
    this.child0 = child0;
    this.child1 = child1;

    this.data = new Set();
  }

  addData(data) {
    if (Array.isArray(data)) {
      data.forEach((d) => this.data.add(d));
    } else {
      this.data.add(data);
    }
  }

  isMergeable() {
    return this.child0.isTerminal !== null
      && this.child0.data !== null
      && this.child0.isTerminal === this.child1.isTerminal
      && this.child0.data === this.child1.data;
  }
}

export class CidrTrie {
  constructor(version) {
    if (version !== IpVersion.IPV4 && version !== IpVersion.IPV6) {
      throw new Error('The version must be either IPV4 or IPV6');
    }

    this.version = version;
    this.root = new TrieNode();
  }

  add(prefixData, ipAddressKey) {
    const { [ipAddressKey]: prefix } = prefixData;
    const cidr = parseCidr(this.version, prefix);
    this.#setData(cidr, new Set([prefixData]));
  }

  lookup(ipAddress) {
    const result = this.#query(parseAddress(this.version, ipAddress));
    if (!result.isPresent) {
      return [];
    }
    return result.data.map((data) => ({...data, ipAddress}));
  }

  #nextBit(address, depth) {
    const bitIndex = (this.version === IpVersion.IPV4 ? 31 : 127) - depth;
    return (address >> BigInt(bitIndex)) & 1n;
  }

  #setData(cidr, data, node = this.root, depth = 0) {
    if (depth === cidr.mask) {
      node.isTerminal = true;
      node.addData([...data]);
      return;
    }

    if (node.isTerminal) {
      node.isTerminal = false;
    }

    if (node.isTerminal !== null) {
      node.child0 = new TrieNode({ isTerminal: node.isTerminal });
      node.child1 = new TrieNode({ isTerminal: node.isTerminal });
      node.isTerminal = null;
    }

    node.child0?.addData([...node.data]);
    node.child1?.addData([...node.data]);

    const child = this.#nextBit(cidr.address, depth) === 0n ? node.child0 : node.child1;
    this.#setData(cidr, [...data], child, depth + 1);

    if (node.isMergeable()) {
      node.isTerminal = node.child0.isTerminal;
      node.addData([...node.child0.data]);
      node.child0 = null;
      node.child1 = null;
    }
  }

  #query(cidr, node = this.root, depth = 0) {
    if (node === null) {
      return { isPresent: false, data: null };
    }

    if (depth === cidr.mask) {
      return { isPresent: node.isTerminal === true, data: [...node.data] };
    }

    if (node.isTerminal !== null) {
      return { isPresent: node.isTerminal, data: [...node.data] };
    }

    const child = this.#nextBit(cidr.address, depth) === 0n ? node.child0 : node.child1;
    return this.#query(cidr, child, depth + 1);
  }
}
