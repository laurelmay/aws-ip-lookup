import { getIpData } from './data-store.js';
import { copyText } from './copy-text.js';
import { CidrTrie, IpVersion, isIpv4Address, isIpv6Address } from './ip-address.js';

const DnsType = Object.freeze({
  A: 1,
  AAAA: 28
});

function looksLikeAnIpAddress(test) {
  return isIpv4Address(test) || isIpv6Address(test);
}

function createCopyButton(text) {
  const icon = document.createElement('i');
  icon.classList.add('fa-regular', 'fa-copy');

  const button = document.createElement('button');
  button.classList.add('copy-button');
  button.title = "Copy"
  button.appendChild(icon);

  button.onclick = () => copyText(text, button, icon);

  return button;
}

function createCell(text, copyable) {
  const cell = document.createElement("td");
  const wrapper = document.createElement('div');
  const span = document.createElement('span');
  const content = Array.isArray(text) ? text.join(", ") : text;
  span.appendChild(document.createTextNode(content));

  wrapper.appendChild(span);
  if (copyable) {
    wrapper.appendChild(createCopyButton(content));
    wrapper.classList.add('spread-items');
  }
  cell.appendChild(wrapper);

  return cell;
}

function createRow(match) {
  const row = document.createElement("tr");
  const address = createCell(match.ipAddress, true);
  address.scope = "row";
  row.appendChild(address);
  row.appendChild(createCell(match.ip_prefix ?? match.ipv6_prefix, true));
  row.appendChild(createCell(match.region));
  row.appendChild(createCell(match.service));
  row.appendChild(createCell(match.network_border_group));
  return row;
}

async function lookupDnsForHostname(name, type) {
  const response = await fetch('https://cloudflare-dns.com/dns-query?' + new URLSearchParams({ type, name }), {
    method: 'GET',
    headers: {
      'Accept': 'application/dns-json',
    },
    signal: AbortSignal.timeout(3000),
  });
  const json = await response.json();
  return json.Answer?.filter((answer) => answer.type === type).map(({ data }) => data);
}

function getMatches(version, ipAddress) {
  let matches = (version === IpVersion.IPV4) ? v4Trie.lookup(ipAddress) : v6Trie.lookup(ipAddress);

  if (!matches?.length) {
    return [];
  }

  if (matches.length === 1) {
    return matches;
  }

  return matches.filter(({ service }) => service !== 'AMAZON');
}

async function handleLookup() {
  const input = document.getElementById('lookup');
  if (!input.value && input.placeholder) {
    input.value = input.placeholder;
  }
  const text = input.value?.trim();
  if (!text) {
    throw new Error('A value to lookup must be provided');
  }
  if (text && new URL(window.location).searchParams?.get('lookup') !== text) {
    const newUrl = new URL(window.location);
    newUrl.search = new URLSearchParams({ lookup: text }).toString()
    window.history.pushState({ path: newUrl.toString() }, '', newUrl.toString());
  }
  const matches = [];
  if (isIpv4Address(text)) {
    matches.push(...getMatches(IpVersion.IPV4, text));
  } else if (isIpv6Address(text)) {
    matches.push(...getMatches(IpVersion.IPV6, text));
  } else {
    const v4Promise = lookupDnsForHostname(text, DnsType.A);
    const v6Promise = lookupDnsForHostname(text, DnsType.AAAA);
    const [v4s, v6s] = await Promise.all([v4Promise, v6Promise]);
    matches.push(...(v4s?.flatMap((address) => getMatches(IpVersion.IPV4, address)) ?? []));
    matches.push(...(v6s?.flatMap((address) => getMatches(IpVersion.IPV6, address)) ?? []));
  }
  return { lookup: text, matches };
}

function handleSubmit() {
  const table = document.getElementById('table');
  const errorContainer = document.getElementById('error-container');
  const notFound = document.getElementById('not-found');
  const loading = document.getElementById('loading');
  const heading = document.getElementById('table-heading');
  loading.style.display = 'block';
  table.style.display = 'none';
  table.style.visibility = 'visible';
  errorContainer.style.display = 'none';
  notFound.style.display = 'none';
  notFound.replaceChildren([]);
  handleLookup()
    .then(({ lookup, matches }) => {
      if (matches?.length) {
        const rows = matches.map((match) => createRow(match));
        const tableBody = document.getElementById('table-body');
        heading.innerText = lookup;
        tableBody.replaceChildren(...rows);
        loading.style.display = 'none';
        table.style.display = 'table';
      } else {
        notFound.appendChild(document.createTextNode('It looks like '));
        const codeNode = document.createElement('code');
        codeNode.innerText = lookup;
        notFound.appendChild(codeNode);
        const isHostedText = !looksLikeAnIpAddress(lookup) ? ' hosted ' : ' ';
        notFound.appendChild(document.createTextNode(` may not be${isHostedText}within AWS-owned IP space.`));
        loading.style.display = 'none';
        notFound.style.display = 'block';
      }
    })
    .catch((error) => {
      const errorHead = document.createElement('span');
      const errorMessage = document.createElement('span')
      errorHead.className = 'error-head';
      errorHead.innerText = 'Unable to load data';
      errorMessage.className = 'error-message';
      errorMessage.innerText = error.toString();

      errorContainer.replaceChildren(
        errorHead,
        document.createElement('br'),
        errorMessage,
        document.createElement('br'),
      );

      if (error.stack) {
        const errorStack = document.createElement('details');
        const errorStackSummary = document.createElement('summary');
        const errorStackDetails = document.createElement('pre');
        errorStackSummary.innerText = 'Error details';
        errorStackDetails.className = 'error-stack-details';
        errorStackDetails.innerText = error.stack;
        errorStack.className = 'error-stack';
        errorStack.appendChild(errorStackSummary);
        errorStack.appendChild(errorStackDetails);
        errorContainer.appendChild(errorStack);
      }

      loading.style.display = "none";
      errorContainer.style.display = "block";
    });
}

const ipData = await getIpData();
const v4Trie = new CidrTrie(IpVersion.IPV4);
const v6Trie = new CidrTrie(IpVersion.IPV6);

for (const prefix of ipData['prefixes']) {
  v4Trie.add(prefix, 'ip_prefix');
}
for (const prefix of ipData['ipv6_prefixes']) {
  v6Trie.add(prefix, 'ipv6_prefix');
}

document.getElementById('form').onsubmit = () => handleSubmit();

function loadFromUrl() {
  const urlInput = new URL(window.location).searchParams?.get('lookup');
  if (urlInput) {
    document.getElementById('lookup').value = urlInput;
    handleSubmit();
  } else {
    document.getElementById('lookup').focus();
  }
}
loadFromUrl();

window.addEventListener('popstate', () => loadFromUrl());
