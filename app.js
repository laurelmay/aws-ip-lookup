import { getIpData } from './data-store.js';
import { copyText } from './copy-text.js';
import { CidrTrie, ipAddressToNumber, IpVersion, isIpv4Address, isIpv6Address } from './ip-address.js';

let currentLookupController = undefined;

const DnsType = Object.freeze({
  A: 1,
  AAAA: 28
});

function looksLikeAnIpAddress(test) {
  return isIpv4Address(test) || isIpv6Address(test);
}

function createCopyButton(text) {
  const icon = document.createElement('i');
  icon.classList.add('bi-copy');

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
  address.dataset.label = 'Address';
  row.appendChild(address);

  const ipPrefix = createCell(match.ip_prefix ?? match.ipv6_prefix, true);
  ipPrefix.dataset.label = 'Prefix';
  row.appendChild(ipPrefix);

  const region = createCell(match.region);
  region.dataset.label = 'Region';
  row.appendChild(region);

  const service = createCell(match.service);
  service.dataset.label = 'Service';
  row.appendChild(service);

  const borderGroup = createCell(match.network_border_group);
  borderGroup.dataset.label = 'Network Border Group';
  row.appendChild(borderGroup);
  return row;
}

async function lookupDnsForHostname(name, type, signal) {
  const response = await fetch('https://cloudflare-dns.com/dns-query?' + new URLSearchParams({ type, name }), {
    method: 'GET',
    headers: {
      'Accept': 'application/dns-json',
    },
    signal: AbortSignal.any([AbortSignal.timeout(3000), signal]),
  });
  if (!response.ok) {
    return undefined;
  }
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

  const filtered = matches.filter(({ service }) => service !== 'AMAZON');
  return filtered?.length ? filtered : matches;
}

async function handleLookup(signal) {
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
    const v4Promise = lookupDnsForHostname(text, DnsType.A, signal);
    const v6Promise = lookupDnsForHostname(text, DnsType.AAAA, signal);
    const [v4s, v6s] = await Promise.all([v4Promise, v6Promise]);
    matches.push(...(v4s?.flatMap((address) => getMatches(IpVersion.IPV4, address)) ?? []));
    matches.push(...(v6s?.flatMap((address) => getMatches(IpVersion.IPV6, address)) ?? []));
  }
  const sortedMatches = matches.toSorted((a, b) => {
    const aNumber = ipAddressToNumber(a.ipAddress);
    const bNumber = ipAddressToNumber(b.ipAddress);
    return aNumber < bNumber ? -1 : aNumber > bNumber ? 1 : 0;
  });
  console.log(sortedMatches);
  return { lookup: text, matches: sortedMatches };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function showLoading() {
  const loading = document.getElementById('loading');
  loading.style.display = 'block';
}

function hideLoading() {
  const loading = document.getElementById('loading');
  loading.style.display = 'none';
}

async function withLoadingIndicator(func) {
  showLoading();
  const passed = new Promise((resolve, reject) => {
    try {
      resolve(func());
    } catch (err) {
      reject(err);
    }
  });
  try {
    const [, result] = await Promise.all([sleep(250), passed]);
    return result;
  } finally {
    hideLoading();
  }
}

function handleSubmit() {
  if (currentLookupController) {
    currentLookupController.abort();
  }
  currentLookupController = new AbortController();
  const table = document.getElementById('table');
  const errorContainer = document.getElementById('error-container');
  const notFound = document.getElementById('not-found');
  const heading = document.getElementById('table-heading');
  table.style.display = 'none';
  table.style.visibility = 'visible';
  heading.style.display = 'none';
  errorContainer.style.display = 'none';
  notFound.style.display = 'none';
  notFound.replaceChildren();
  showLoading();
  handleLookup(currentLookupController.signal)
    .then(async ({ lookup, matches }) => {
      await withLoadingIndicator(() => {});
      if (matches?.length) {
        const rows = matches.map((match) => createRow(match));
        const tableBody = document.getElementById('table-body');
        heading.innerText = lookup;
        heading.style.display = 'block';
        tableBody.replaceChildren(...rows);
        table.style.display = 'table';
      } else {
        heading.style.display = 'none';
        notFound.appendChild(document.createTextNode('It looks like '));
        const codeNode = document.createElement('code');
        codeNode.innerText = lookup;
        notFound.appendChild(codeNode);
        const isHostedText = !looksLikeAnIpAddress(lookup) ? ' hosted ' : ' ';
        notFound.appendChild(document.createTextNode(` may not be${isHostedText}within AWS-owned IP space.`));
        hideLoading();
        notFound.style.display = 'block';
      }
    })
    .catch((error) => {
      if (error.name === 'AbortError') {
        return;
      }
      displayError(error);
    });
}

const displayError = (error) => {
  const errorContainer = document.getElementById('error-container');
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

  hideLoading();
  errorContainer.style.display = "block";
};

const v4Trie = new CidrTrie(IpVersion.IPV4);
const v6Trie = new CidrTrie(IpVersion.IPV6);

const submitButton = document.getElementById('submit');
const ready = (async () => {
  try {
    await withLoadingIndicator(async () => {
      const ipData = await getIpData();
      for (const prefix of ipData['prefixes']) {
        v4Trie.add(prefix, 'ip_prefix');
      }
      for (const prefix of ipData['ipv6_prefixes']) {
        v6Trie.add(prefix, 'ipv6_prefix');
      }
    })
    submitButton.disabled = false;
  } catch (err) {
    displayError(err);
  }
})();

document.getElementById('form').onsubmit = (event) => {
  event.preventDefault();
  handleSubmit();
}
document.getElementById('lookup').onfocus = ((event) => event.target.select());

async function loadFromUrl() {
  const urlInput = new URL(window.location).searchParams?.get('lookup');
  if (urlInput) {
    document.getElementById('lookup').value = urlInput;
    await ready;
    handleSubmit();
  } else {
    document.getElementById('lookup').focus();
  }
}
loadFromUrl();

window.addEventListener('popstate', () => loadFromUrl());
