import { expect } from 'chai';
import { framework } from '../test-framework.js';
import { expectValidTabInfo, delay } from './helpers.js';

describe('Network Monitoring Tool Tests', function() {
  this.timeout(30000);

  afterEach(async function() {
    // Always leave monitoring fully off (clears any watcher this suite added)
    await framework.callToolAndParse('network_monitor', { enabled: false, force: true });
  });

  it('should enable and disable monitoring', async function() {
    let data = await framework.callToolAndParse('network_monitor', { enabled: true });
    expectValidTabInfo(data);
    expect(data.monitoring).to.equal(true);
    expect(data.watchers).to.equal(1);

    data = await framework.callToolAndParse('network_monitor', { enabled: false });
    expect(data.monitoring).to.equal(false);
    expect(data.watchers).to.equal(0);
  });

  it('should be idempotent per watcher', async function() {
    await framework.callToolAndParse('network_monitor', { enabled: true });
    const data = await framework.callToolAndParse('network_monitor', { enabled: true });
    expect(data.monitoring).to.equal(true);
    expect(data.watchers).to.equal(1); // same caller, not double-counted
  });

  it('should stay on until the last watcher disables', async function() {
    // This MCP connection is one watcher; clientId simulates a second client
    await framework.callToolAndParse('network_monitor', { enabled: true });
    let data = await framework.callToolAndParse('network_monitor', { enabled: true, clientId: 'other-client' });
    expect(data.watchers).to.equal(2);

    data = await framework.callToolAndParse('network_monitor', { enabled: false });
    expect(data.monitoring).to.equal(true); // other-client still watching
    expect(data.watchers).to.equal(1);

    data = await framework.callToolAndParse('network_monitor', { enabled: false, clientId: 'other-client' });
    expect(data.monitoring).to.equal(false);
    expect(data.watchers).to.equal(0);
  });

  it('should force-disable regardless of other watchers', async function() {
    await framework.callToolAndParse('network_monitor', { enabled: true });
    await framework.callToolAndParse('network_monitor', { enabled: true, clientId: 'other-client' });

    const data = await framework.callToolAndParse('network_monitor', { enabled: false, force: true });
    expect(data.monitoring).to.equal(false);
    expect(data.watchers).to.equal(0);
  });

  it('should capture navigation requests with metadata', async function() {
    await framework.callToolAndParse('network_monitor', { enabled: true });
    await framework.callToolAndParse('navigate', {
      url: 'http://localhost:61822/test.html?net=' + Date.now()
    });
    await delay(500);

    const data = await framework.callToolAndParse('network_requests', {});
    expect(data.monitoring).to.equal(true);
    expect(data.requests).to.be.an('array').that.is.not.empty;
    expect(data.cursor).to.be.a('number');
    expect(data.totalBuffered).to.be.a('number');

    const doc = data.requests.find(r => r.resourceType === 'document' && r.url.includes('test.html'));
    expect(doc, 'document request for test.html').to.exist;
    expect(doc.requestId).to.be.a('string');
    expect(doc.seq).to.be.a('number');
    expect(doc.method).to.equal('GET');
    expect(doc.status).to.equal(200);
    expect(doc.mimeType).to.include('text/html');
  });

  it('should return only newer requests with a since cursor', async function() {
    await framework.callToolAndParse('network_monitor', { enabled: true });
    await framework.callToolAndParse('navigate', {
      url: 'http://localhost:61822/test.html?first=' + Date.now()
    });
    await delay(500);

    const first = await framework.callToolAndParse('network_requests', {});
    const cursor = first.cursor;
    expect(cursor).to.be.greaterThan(0);

    await framework.callToolAndParse('navigate', {
      url: 'http://localhost:61822/test.html?second=' + Date.now()
    });
    await delay(500);

    const second = await framework.callToolAndParse('network_requests', { since: cursor });
    expect(second.requests).to.be.an('array').that.is.not.empty;
    for (const r of second.requests) {
      expect(r.seq).to.be.greaterThan(cursor);
    }
    const doc = second.requests.find(r => r.url.includes('second='));
    expect(doc, 'the post-cursor navigation').to.exist;
  });

  it('should fetch a response body with headers', async function() {
    await framework.callToolAndParse('network_monitor', { enabled: true });
    await framework.callToolAndParse('navigate', {
      url: 'http://localhost:61822/test.html?body=' + Date.now()
    });
    await delay(500);

    const list = await framework.callToolAndParse('network_requests', {});
    const doc = list.requests.find(r => r.resourceType === 'document' && r.url.includes('test.html'));
    expect(doc, 'document request for test.html').to.exist;

    const data = await framework.callToolAndParse('network_body', { requestId: doc.requestId });
    expect(data.requestId).to.equal(doc.requestId);
    expect(data.base64Encoded).to.equal(false);
    expect(data.body).to.be.a('string').that.includes('Kapture');
    expect(data.size).to.be.greaterThan(0);
    expect(data.responseHeaders).to.be.an('object');
    expect(data.requestHeaders).to.be.an('object');
  });

  it('should truncate the body to maxBytes', async function() {
    await framework.callToolAndParse('network_monitor', { enabled: true });
    await framework.callToolAndParse('navigate', {
      url: 'http://localhost:61822/test.html?trunc=' + Date.now()
    });
    await delay(500);

    const list = await framework.callToolAndParse('network_requests', {});
    const doc = list.requests.find(r => r.resourceType === 'document' && r.url.includes('test.html'));

    const data = await framework.callToolAndParse('network_body', { requestId: doc.requestId, maxBytes: 1024 });
    expect(data.bodyTruncated).to.equal(true);
    expect(data.body.length).to.be.at.most(1024);
    expect(data.size).to.be.greaterThan(1024); // full size still reported
  });

  it('should report monitoring:false when off', async function() {
    const data = await framework.callToolAndParse('network_requests', {});
    expect(data.monitoring).to.equal(false);
    expect(data.requests).to.be.an('array').that.is.empty;
  });

  it('should error on network_body when monitoring is off', async function() {
    const data = await framework.callToolAndParse('network_body', { requestId: 'nope' });
    expect(data).to.have.property('error');
    expect(data.error.code).to.equal('NOT_MONITORING');
  });

  it('should clear the buffer when monitoring fully stops', async function() {
    await framework.callToolAndParse('network_monitor', { enabled: true });
    await framework.callToolAndParse('navigate', {
      url: 'http://localhost:61822/test.html?clear=' + Date.now()
    });
    await delay(500);
    await framework.callToolAndParse('network_monitor', { enabled: false });

    const data = await framework.callToolAndParse('network_monitor', { enabled: true });
    expect(data.bufferedCount).to.equal(0); // previous session's buffer is gone
  });
});
