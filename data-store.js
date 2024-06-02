const ipDataUrl = new URL("https://ip-ranges.amazonaws.com/ip-ranges.json");

async function retrieveFromAws() {
  const ipDataResponse = await fetch(ipDataUrl);
  const ipData = await ipDataResponse.json();
  const timestamp = Date.parse(ipDataResponse.headers.get('Last-Modified'));
  return {
    data: ipData,
    timestamp,
  }
}

async function checkLastestAws() {
  try {
    const response = await fetch(ipDataUrl, { method: 'HEAD' });
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
  const timestamp = Date.parse(localStorage.getItem('aws-ip-timestamp') ?? 0);
  const latest = await checkLastestAws();
  if (timestamp < latest) {
    await populateCache();
  }
  const data = JSON.parse(localStorage.getItem('aws-ip-data'));
  return data;
}
