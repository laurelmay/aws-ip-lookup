import { isInSubnet } from "https://cdn.jsdelivr.net/npm/is-in-subnet@4.0.1/+esm";
const ipDataUrl = new URL("https://ip-ranges.amazonaws.com/ip-ranges.json");
const ipDataResponse = await fetch(ipDataUrl);
const ipData = await ipDataResponse.json();

function createCell(text) {
  const cell = document.createElement("td");
  if (Array.isArray(text)) {
    cell.appendChild(document.createTextNode(text.join(", ")));
  } else {
    cell.appendChild(document.createTextNode(text));
  }
  return cell;
}
function createRow(address, prefix, regions, services, borderGroups) {
  const row = document.createElement("tr");
  row.appendChild(createCell(address));
  row.appendChild(createCell(prefix));
  row.appendChild(createCell(regions));
  row.appendChild(createCell(services));
  row.appendChild(createCell(borderGroups));
  return row;
}

async function getIpv4ForHostname(name) {
  const response = await fetch('https://cloudflare-dns.com/dns-query?' + new URLSearchParams({type: 'A', name }), {
    method: 'GET',
    headers: {
      'Accept': 'application/dns-json',
    },
  });
  const json = await response.json();
  const answers = json.Answer;
  return answers?.filter(({ type }) => type === 1).map(({ data }) => data);
}

async function getIpv6ForHostname(name) {
  const response = await fetch('https://cloudflare-dns.com/dns-query?' + new URLSearchParams({type: 'AAAA', name }), {
    method: 'GET',
    headers: {
      'Accept': 'application/dns-json',
    },
  });
  const json = await response.json();
  const answers = json.Answer;
  return answers?.filter(({ type }) => type === 28).map(({ data }) => data) ?? [];
}

function getMatchesv4(ipAddress) {
  return ipData["prefixes"].filter(({ ip_prefix }) => isInSubnet(ipAddress, ip_prefix)).map((match) => ({ ...match, ipAddress }));
}

function getMatchesv6(ipAddress) {
  return ipData["ipv6_prefixes"].filter(({ ipv6_prefix }) => isInSubnet(ipAddress, ipv6_prefix)).map((match) => ({ ...match, ipAddress }));
}

async function handleLookup() {
  const input = document.getElementById("input");
  const text = input.value;
  const ipv4ishRegex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
  const ipv6ishRegex = /^[\d:]+$/;
  const matches = [];
  if (ipv4ishRegex.test(text)) {
    matches.push(...getMatchesv4(text));
  } else if (ipv6ishRegex.test(text)) {
    matches.push(...getMatchesv6(text));
  } else {
    const v4Promise = getIpv4ForHostname(text);
    const v6Promise = getIpv6ForHostname(text);
    const [v4s, v6s] = await Promise.all([v4Promise, v6Promise]);
    matches.push(...v4s.flatMap((address) => getMatchesv4(address)));
    matches.push(...v6s.flatMap((address) => getMatchesv6(address)));
  }
  return matches;
}

function handleSubmit() {
  const table = document.getElementById("table");
  const errorContainer = document.getElementById("error-container");
  const notFound = document.getElementById("not-found");
  const loading = document.getElementById("loading");
  loading.style.display = "block";
  table.style.display = "none";
  errorContainer.style.display = "none";
  notFound.style.display = "none";
  handleLookup()
    .then((matches) => {
      if (matches?.length) {
        const rows = matches.map((match) => createRow(match.ipAddress, match.ip_prefix ?? match.ipv6_prefix, match.region, match.service, match.network_border_group));
        const tableBody = document.getElementById("table-body");
        tableBody.replaceChildren(...rows);
        loading.style.display = "none";
        table.style.display = "table";
      } else {
        const input = document.getElementById("input").value;
        notFound.innerText = `It looks like ${input} may not be in AWS.`;
        loading.style.display = "none";
        notFound.style.display = "block";
      }
    })
    .catch((error) => {
      errorContainer.innerText = "Unable to load data\n" + error + "\n" + error.stack;
      loading.style.display = "none";
      errorContainer.style.display = "block";
    })
}

document.getElementById("form").onsubmit = () => handleSubmit();

