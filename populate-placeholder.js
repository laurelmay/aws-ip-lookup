const placeholders = [
  'awsips.info',
  'aws.amazon.com',
  'canvas.jmu.edu',
  'checkip.amazonaws.com',
  'courtlistener.com',
  'gsa.gov',
  'ip-ranges.amazonaws.com',
  'microcenter.com',
  'mozilla.org',
  'netflix.com',
  'pbs.org',
  'public.cyber.mil',
  'w3schools.com',
  'ynab.com',
  'pokemon.com',
  '54.245.168.10',
  '2406:da13::0aef',
  '2406:da68:800:c100::0001',
  '15.188.210.64',
  '3.146.42.64',
  '3.101.202.127',
  '2406:da14:1713:ba00::/56',
  '2406:da2a::/36',
  '2600:1ffb:8000::/39',
];

document.getElementById('lookup').placeholder = placeholders[Math.floor(Math.random() * placeholders.length)];
