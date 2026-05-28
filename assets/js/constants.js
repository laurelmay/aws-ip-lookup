const SERVICE_NAMES_DATA = [
  ['AMAZON', 'Unspecified'],
  ['AMAZON_APPFLOW', 'AppFlow'],
  ['AMAZON_CONNECT', 'Connect'],
  ['API_GATEWAY', 'API Gateway'],
  ['AURORA_DSQL', 'Aurora DSQL'],
  ['CHIME_MEETINGS', 'Chime Meetings'],
  ['CHIME_VOICECONNECTOR', 'Chime Voice Connector'],
  ['CLOUD9', 'Cloud9'],
  ['CLOUDFRONT', 'CloudFront'],
  ['CLOUDFRONT_ORIGIN_FACING', 'CloudFront (origin-facing)'],
  ['CODEBUILD', 'CodeBuild'],
  ['DYNAMODB', 'DynamoDB'],
  ['EBS', 'EBS'],
  ['EC2', 'EC2'],
  ['EC2_INSTANCE_CONNECT', 'EC2 Instance Connect'],
  ['GLOBALACCELERATOR', 'Global Accelerator'],
  ['IVS_LOW_LATENCY', 'IVS Low-Latency'],
  ['IVS_REALTIME', 'IVS Real-Time'],
  ['KINESIS_VIDEO_STREAMS', 'Kinesis Video Streams'],
  ['MEDIA_PACKAGE_V2', 'MediaPackage v2'],
  ['ROUTE53', 'Route53'],
  ['ROUTE53_HEALTHCHECKS', 'Route53 (health checks)'],
  ['ROUTE53_HEALTHCHECKS_PUBLISHING', 'Route53 (health checks publishing)'],
  ['ROUTE53_RESOLVER', 'Route53 Resolver'],
  ['S3', 'S3'],
  ['WORKSPACES_GATEWAYS', 'WorkSpaces gateways'],
];

const SERVICE_PALETTE_DATA = [
  ['AMAZON', '#B8CCF0'],
  ['AMAZON_APPFLOW', '#C8B8F0'],
  ['AMAZON_CONNECT', '#B8EEE0'],
  ['API_GATEWAY', '#A8DDCC'],
  ['AURORA_DSQL', '#E0B8F0'],
  ['CHIME_MEETINGS', '#B8F0D8'],
  ['CHIME_VOICECONNECTOR', '#C0EEB8'],
  ['CLOUD9', '#F0EEB0'],
  ['CLOUDFRONT', '#D0B0F0'],
  ['CLOUDFRONT_ORIGIN_FACING', '#E8B8E0'],
  ['CODEBUILD', '#F0B8B8'],
  ['DYNAMODB', '#C8B0E8'],
  ['EBS', '#F0D0A0'],
  ['EC2', '#F8D8A8'],
  ['EC2_INSTANCE_CONNECT', '#F8E8A8'],
  ['GLOBALACCELERATOR', '#A8E8E8'],
  ['IVS_LOW_LATENCY', '#F8E0A8'],
  ['IVS_REALTIME', '#D8F0A8'],
  ['KINESIS_VIDEO_STREAMS', '#A8CCF0'],
  ['MEDIA_PACKAGE_V2', '#F8C8A8'],
  ['ROUTE53', '#F0B8CC'],
  ['ROUTE53_HEALTHCHECKS', '#F0C8B8'],
  ['ROUTE53_HEALTHCHECKS_PUBLISHING', '#F8D0C0'],
  ['ROUTE53_RESOLVER', '#F0B8D8'],
  ['S3', '#B0E8B0'],
  ['WORKSPACES_GATEWAYS', '#A8C8F8'],

  ['MULTIPLE', '#DFC7A7'],
];

class FreezableMap extends Map {
  set(...args) {
    if (Object.isFrozen(this)) {
      return this;
    }
    return super.set(...args);
  }
  delete(...args) {
    if (Object.isFrozen(this)) {
      return false;
    }
    return super.delete(...args);
  }
  clear() {
    if (Object.isFrozen(this)) {
      return undefined;
    }
    return super.clear();
  }
  getOrInsert(...args) {
    if (Object.isFrozen(this)) {
      throw new Error('Not supported on frozen map');
    }
    super.getOrInsert(...args);
  }
  getOrInsertComputed(...args) {
    if (Object.isFrozen(this)) {
      throw new Error('Not supported on frozen map');
    }
    super.getOrInsertComputed(...args);
  }
}

export const SERVICE_NAMES = Object.freeze(new FreezableMap(SERVICE_NAMES_DATA));
export const SERVICE_COLORS = Object.freeze(new FreezableMap(SERVICE_PALETTE_DATA));
