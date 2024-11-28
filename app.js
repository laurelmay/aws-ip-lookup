import { isInSubnet } from "https://cdn.jsdelivr.net/npm/is-in-subnet@4.0.1/+esm";
import { getIpData } from './data-store.js';
import { copyText } from './copy-text.js';

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
  const typeNumber = type === 'A' ? 1 : 28;
  const response = await fetch('https://cloudflare-dns.com/dns-query?' + new URLSearchParams({ type, name }), {
    method: 'GET',
    headers: {
      'Accept': 'application/dns-json',
    },
    signal: AbortSignal.timeout(3000),
  });
  const json = await response.json();
  return json.Answer?.filter((answer) => answer.type === typeNumber).map(({ data }) => data);
}

function getMatchesHelper(key, objField, ipAddress) {
  const matches = ipData[key]
    .filter(({ [objField]: prefix }) => isInSubnet(ipAddress, prefix))
    .map((match) => ({ ...match, ipAddress }));
  if (!matches.length) {
    return [];
  }
  if (matches.length == 1) {
    return matches;
  }
  // Remove duplicate entries listed as just being 'AMAZON'
  return matches.filter(({ service }) => service !== 'AMAZON');
}

function getMatchesv4(ipAddress) {
  return getMatchesHelper('prefixes', 'ip_prefix', ipAddress);
}

function getMatchesv6(ipAddress) {
  return getMatchesHelper('ipv6_prefixes', 'ipv6_prefix', ipAddress);
}

async function handleLookup() {
  const input = document.getElementById("lookup");
  if (!input.value && input.placeholder) {
    input.value = input.placeholder;
  }
  const text = input.value?.trim();
  if (!text) {
    throw new Error('A value to lookup must be provided');
  }
  if (text && new URL(window.location).searchParams?.get("lookup") !== text) {
    const newUrl = new URL(window.location);
    newUrl.search = new URLSearchParams({ lookup: text }).toString()
    window.history.pushState({ path: newUrl.toString() }, '', newUrl.toString());
  }
  const ipv4ishRegex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
  const ipv6ishRegex = /^[a-f\d:]+$/i;
  const matches = [];
  if (ipv4ishRegex.test(text)) {
    matches.push(...getMatchesv4(text));
  } else if (ipv6ishRegex.test(text)) {
    matches.push(...getMatchesv6(text));
  } else {
    const v4Promise = lookupDnsForHostname(text, 'A');
    const v6Promise = lookupDnsForHostname(text, 'AAAA');
    const [v4s, v6s] = await Promise.all([v4Promise, v6Promise]);
    matches.push(...(v4s?.flatMap((address) => getMatchesv4(address)) ?? []));
    matches.push(...(v6s?.flatMap((address) => getMatchesv6(address)) ?? []));
  }
  return matches;
}

function handleSubmit() {
  const table = document.getElementById("table");
  const errorContainer = document.getElementById("error-container");
  const notFound = document.getElementById("not-found");
  const loading = document.getElementById("loading");
  const heading = document.getElementById("table-heading");
  const input = document.getElementById("lookup").value;
  loading.style.display = "block";
  table.style.display = "none";
  table.style.visibility = "visible";
  errorContainer.style.display = "none";
  notFound.style.display = "none";
  notFound.replaceChildren([]);
  handleLookup()
    .then((matches) => {
      if (matches?.length) {
        const rows = matches.map((match) => createRow(match));
        const tableBody = document.getElementById("table-body");
        heading.innerText = input;
        tableBody.replaceChildren(...rows);
        loading.style.display = "none";
        table.style.display = "table";
      } else {
        notFound.appendChild(document.createTextNode('It looks like '));
        const codeNode = document.createElement("code");
        codeNode.innerText = input;
        notFound.appendChild(codeNode);
        notFound.appendChild(document.createTextNode(' may not be within AWS-owned IP space.'));
        loading.style.display = "none";
        notFound.style.display = "block";
      }
    })
    .catch((error) => {
      errorContainer.innerText = "Unable to load data\n" + error + "\n" + error.stack;
      loading.style.display = "none";
      errorContainer.style.display = "block";
    });
}

const ipData = await getIpData();
document.getElementById("form").onsubmit = () => handleSubmit();

function loadFromUrl() {
  const urlInput = new URL(window.location).searchParams?.get("lookup");
  if (urlInput) {
    document.getElementById("lookup").value = urlInput;
    handleSubmit();
  } else {
    document.getElementById("lookup").focus();
  }
}
loadFromUrl();

window.addEventListener('popstate', () => loadFromUrl());
