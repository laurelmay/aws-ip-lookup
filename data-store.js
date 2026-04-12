const IP_DATA_URL = new URL('https://ip-ranges.amazonaws.com/ip-ranges.json');

async function retrieveFromAws() {
  const ipDataResponse = await fetch(IP_DATA_URL, { signal: AbortSignal.timeout(10_000) });
  const ipData = await ipDataResponse.json();
  const timestamp = Date.parse(ipDataResponse.headers.get('Last-Modified'));
  return {
    data: ipData,
    timestamp,
  }
}

async function checkLatestAws() {
  try {
    const response = await fetch(IP_DATA_URL, { method: 'HEAD', signal: AbortSignal.timeout(3_000) });
    const timestamp = Date.parse(response.headers.get('Last-Modified'));
    return timestamp;
  } catch (e) {
    // Fallback to returning a date hopefully very far in the future
    return Date.UTC(9999, 11, 31);
  }
}

async function populateCache() {
  const data = await retrieveFromAws();
  localStorage.setItem('aws-ip-data', JSON.stringify(data.data));
  localStorage.setItem('aws-ip-timestamp', data.timestamp.toString());
  return data.data;
}

export async function getIpData() {
  const timestamp = Number.parseInt(localStorage.getItem('aws-ip-timestamp') ?? 0);
  const preData = localStorage.getItem('aws-ip-data');
  const latest = await checkLatestAws();
  // If the data hasn't been stored or if it's unclear whether the AWS data is newer,
  // fallback to trying to fetch the latest AWS data.
  if (!preData || timestamp < latest) {
    await populateCache();
  }
  const data = JSON.parse(localStorage.getItem('aws-ip-data'));
  return data;
}
