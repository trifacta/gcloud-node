/**
 * Copyright 2014 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

var arrify = require('arrify');
var assert = require('assert');
var extend = require('extend');
var proxyquire = require('proxyquire');
var util = require('@google-cloud/common').util;

var SubscriptionCached = require('../src/subscription.js');
var SubscriptionOverride;

var Topic = require('../src/topic.js');

function Subscription(a, b) {
  var OverrideFn = SubscriptionOverride || SubscriptionCached;
  return new OverrideFn(a, b);
}

var promisified = false;
var fakeUtil = extend({}, util, {
  promisifyAll: function(Class, options) {
    if (Class.name !== 'PubSub') {
      return;
    }

    promisified = true;
    assert.deepEqual(options.exclude, ['subscription', 'topic']);
  }
});

function FakeGrpcService() {
  this.calledWith_ = arguments;
}

var extended = false;
var fakePaginator = {
  extend: function(Class, methods) {
    if (Class.name !== 'PubSub') {
      return;
    }

    methods = arrify(methods);
    assert.equal(Class.name, 'PubSub');
    assert.deepEqual(methods, ['getSubscriptions', 'getTopics']);
    extended = true;
  },
  streamify: function(methodName) {
    return methodName;
  }
};

describe('PubSub', function() {
  var PubSub;
  var PROJECT_ID = 'test-project';
  var pubsub;
  var OPTIONS = { projectId: PROJECT_ID };

  var PUBSUB_EMULATOR_HOST = process.env.PUBSUB_EMULATOR_HOST;

  before(function() {
    delete process.env.PUBSUB_EMULATOR_HOST;
    PubSub = proxyquire('../', {
      '@google-cloud/common': {
        GrpcService: FakeGrpcService,
        paginator: fakePaginator,
        util: fakeUtil
      },
      './subscription.js': Subscription,
      './topic.js': Topic
    });
  });

  after(function() {
    if (PUBSUB_EMULATOR_HOST) {
      process.env.PUBSUB_EMULATOR_HOST = PUBSUB_EMULATOR_HOST;
    }
  });

  beforeEach(function() {
    SubscriptionOverride = null;
    pubsub = new PubSub(OPTIONS);
    pubsub.projectId = PROJECT_ID;
  });

  describe('instantiation', function() {
    it('should extend the correct methods', function() {
      assert(extended); // See `fakePaginator.extend`
    });

    it('should streamify the correct methods', function() {
      assert.strictEqual(pubsub.getSubscriptionsStream, 'getSubscriptions');
      assert.strictEqual(pubsub.getTopicsStream, 'getTopics');
    });

    it('should promisify all the things', function() {
      assert(promisified);
    });

    it('should normalize the arguments', function() {
      var normalizeArguments = fakeUtil.normalizeArguments;
      var normalizeArgumentsCalled = false;
      var fakeOptions = { projectId: PROJECT_ID };
      var fakeContext = {};

      fakeUtil.normalizeArguments = function(context, options) {
        normalizeArgumentsCalled = true;
        assert.strictEqual(context, fakeContext);
        assert.strictEqual(options, fakeOptions);
        return options;
      };

      PubSub.call(fakeContext, fakeOptions);
      assert(normalizeArgumentsCalled);

      fakeUtil.normalizeArguments = normalizeArguments;
    });

    it('should inherit from GrpcService', function() {
      assert(pubsub instanceof FakeGrpcService);

      var calledWith = pubsub.calledWith_[0];

      var baseUrl = 'pubsub.googleapis.com';
      assert.strictEqual(calledWith.baseUrl, baseUrl);
      assert.strictEqual(calledWith.service, 'pubsub');
      assert.strictEqual(calledWith.apiVersion, 'v1');
      assert.deepEqual(calledWith.scopes, [
        'https://www.googleapis.com/auth/pubsub',
        'https://www.googleapis.com/auth/cloud-platform'
      ]);
      assert.deepEqual(calledWith.packageJson, require('../package.json'));
    });

    it('should set the defaultBaseUrl_', function() {
      assert.strictEqual(pubsub.defaultBaseUrl_, 'pubsub.googleapis.com');
    });

    it('should use the PUBSUB_EMULATOR_HOST env var', function() {
      var pubSubHost = 'pubsub-host';
      process.env.PUBSUB_EMULATOR_HOST = pubSubHost;

      var pubsub = new PubSub({ projectId: 'project-id' });
      delete process.env.PUBSUB_EMULATOR_HOST;

      var calledWith = pubsub.calledWith_[0];
      assert.strictEqual(calledWith.baseUrl, pubSubHost);
    });

    it('should localize the options provided', function() {
      assert.strictEqual(pubsub.options, OPTIONS);
    });
  });

  describe('createTopic', function() {
    it('should make the correct API request', function(done) {
      var topicName = 'new-topic-name';
      var formattedName = 'formatted-name';

      var formatName_ = Topic.formatName_;
      Topic.formatName_ = function(projectId, name) {
        Topic.formatName_ = formatName_;
        assert.strictEqual(projectId, pubsub.projectId);
        assert.strictEqual(name, topicName);
        return formattedName;
      };

      pubsub.request = function(protoOpts, reqOpts) {
        assert.strictEqual(protoOpts.service, 'Publisher');
        assert.strictEqual(protoOpts.method, 'createTopic');
        assert.strictEqual(reqOpts.name, formattedName);
        done();
      };

      pubsub.createTopic(topicName, function() {});
    });

    describe('error', function() {
      var error = new Error('Error.');
      var apiResponse = {};

      beforeEach(function() {
        pubsub.request = function(protoOpts, reqOpts, callback) {
          callback(error, apiResponse);
        };
      });

      it('should return an error & API response', function(done) {
        pubsub.createTopic('new-topic', function(err, topic, apiResponse_) {
          assert.strictEqual(err, error);
          assert.strictEqual(topic, null);
          assert.strictEqual(apiResponse_, apiResponse);
          done();
        });
      });
    });

    describe('success', function() {
      var apiResponse = {};

      beforeEach(function() {
        pubsub.request = function(protoOpts, reqOpts, callback) {
          callback(null, apiResponse);
        };
      });

      it('should return a Topic object', function(done) {
        var topicName = 'new-topic';
        var topicInstance = {};

        pubsub.topic = function(name) {
          assert.strictEqual(name, topicName);
          return topicInstance;
        };

        pubsub.createTopic(topicName, function(err, topic) {
          assert.ifError(err);
          assert.strictEqual(topic, topicInstance);
          done();
        });
      });

      it('should pass apiResponse to callback', function(done) {
        pubsub.createTopic('new-topic', function(err, topic, apiResponse_) {
          assert.ifError(err);
          assert.strictEqual(apiResponse_, apiResponse);
          done();
        });
      });
    });
  });

  describe('getSubscriptions', function() {
    beforeEach(function() {
      pubsub.request = function(protoOpts, reqOpts, callback) {
        callback(null, { subscriptions: [{ name: 'fake-subscription' }] });
      };
    });

    it('should accept a query and a callback', function(done) {
      pubsub.getSubscriptions({}, done);
    });

    it('should accept just a callback', function(done) {
      pubsub.getSubscriptions(done);
    });

    it('should pass the correct arguments to the API', function(done) {
      pubsub.request = function(protoOpts, reqOpts) {
        assert.strictEqual(protoOpts.service, 'Subscriber');
        assert.strictEqual(protoOpts.method, 'listSubscriptions');
        assert.strictEqual(reqOpts.project, 'projects/' + pubsub.projectId);
        done();
      };

      pubsub.getSubscriptions(assert.ifError);
    });

    describe('topics', function() {
      var TOPIC;
      var TOPIC_NAME = 'topic';

      beforeEach(function() {
        TOPIC = new Topic(pubsub, TOPIC_NAME);
      });

      it('should subscribe to a topic by string', function(done) {
        pubsub.request = function(protoOpts, reqOpts) {
          assert.strictEqual(protoOpts.service, 'Publisher');
          assert.strictEqual(protoOpts.method, 'listTopicSubscriptions');
          assert.strictEqual(reqOpts.topic, TOPIC_NAME);
          done();
        };

        pubsub.getSubscriptions({ topic: TOPIC_NAME }, assert.ifError);
      });

      it('should subscribe to a topic by Topic instance', function(done) {
        pubsub.request = function(protoOpts, reqOpts) {
          assert.strictEqual(reqOpts.topic, TOPIC.name);
          done();
        };

        pubsub.getSubscriptions({ topic: TOPIC }, assert.ifError);
      });
    });

    it('should pass options to API request', function(done) {
      var opts = { pageSize: 10, pageToken: 'abc' };

      pubsub.request = function(protoOpts, reqOpts) {
        assert.strictEqual(reqOpts.pageSize, opts.pageSize);
        assert.strictEqual(reqOpts.pageToken, opts.pageToken);
        done();
      };

      pubsub.getSubscriptions(opts, assert.ifError);
    });

    it('should pass error & response if api returns an error', function(done) {
      var error = new Error('Error');
      var resp = { error: true };

      pubsub.request = function(protoOpts, reqOpts, callback) {
        callback(error, resp);
      };

      pubsub.getSubscriptions(function(err, subs, nextQuery, apiResponse) {
        assert.equal(err, error);
        assert.deepEqual(apiResponse, resp);
        done();
      });
    });

    describe('returning Subscription instances', function() {
      it('should handle subscriptions.list response', function(done) {
        pubsub.getSubscriptions(function(err, subscriptions) {
          assert.ifError(err);
          assert(subscriptions[0] instanceof SubscriptionCached);
          done();
        });
      });

      it('should handle topics.subscriptions.list response', function(done) {
        var subName = 'sub-name';
        var subFullName =
          'projects/' + PROJECT_ID + '/subscriptions/' + subName;

        pubsub.request = function(protoOpts, reqOpts, callback) {
          callback(null, { subscriptions: [subName] });
        };

        pubsub.getSubscriptions(function(err, subscriptions) {
          assert.ifError(err);
          assert(subscriptions[0] instanceof SubscriptionCached);
          assert.equal(subscriptions[0].name, subFullName);
          done();
        });
      });
    });

    it('should return a query if more results exist', function() {
      var token = 'next-page-token';

      pubsub.request = function(protoOpts, reqOpts, callback) {
        callback(null, { nextPageToken: token });
      };

      var query = { maxResults: 1 };

      pubsub.getSubscriptions(query, function(err, subscriptions, nextQuery) {
        assert.ifError(err);
        assert.strictEqual(query.maxResults, nextQuery.maxResults);
        assert.equal(query.pageToken, token);
      });
    });

    it('should pass apiResponse to callback', function(done) {
      var resp = { success: true };

      pubsub.request = function(protoOpts, reqOpts, callback) {
        callback(null, resp);
      };

      pubsub.getSubscriptions(function(err, subs, nextQuery, apiResponse) {
        assert.equal(resp, apiResponse);
        done();
      });
    });
  });

  describe('getTopics', function() {
    var topicName = 'fake-topic';
    var apiResponse = { topics: [{ name: topicName }]};

    beforeEach(function() {
      pubsub.request = function(protoOpts, reqOpts, callback) {
        callback(null, apiResponse);
      };
    });

    it('should accept a query and a callback', function(done) {
      pubsub.getTopics({}, done);
    });

    it('should accept just a callback', function(done) {
      pubsub.getTopics(done);
    });

    it('should build the right request', function(done) {
      var options = { a: 'b', c: 'd' };
      var originalOptions = extend({}, options);
      var expectedOptions = extend({}, options, {
        project: 'projects/' + pubsub.projectId
      });

      pubsub.request = function(protoOpts, reqOpts) {
        assert.strictEqual(protoOpts.service, 'Publisher');
        assert.strictEqual(protoOpts.method, 'listTopics');
        assert.deepEqual(reqOpts, expectedOptions);
        assert.deepEqual(options, originalOptions);
        done();
      };
      pubsub.getTopics(options, function() {});
    });

    it('should return Topic instances with metadata', function(done) {
      var topic = {};

      pubsub.topic = function(name) {
        assert.strictEqual(name, topicName);
        return topic;
      };

      pubsub.getTopics(function(err, topics) {
        assert.ifError(err);
        assert.strictEqual(topics[0], topic);
        assert.strictEqual(topics[0].metadata, apiResponse.topics[0]);
        done();
      });
    });

    it('should return a query if more results exist', function() {
      var token = 'next-page-token';
      pubsub.request = function(protoOpts, reqOpts, callback) {
        callback(null, { nextPageToken: token });
      };
      var query = { pageSize: 1 };
      pubsub.getTopics(query, function(err, topics, nextQuery) {
        assert.ifError(err);
        assert.strictEqual(query.pageSize, nextQuery.pageSize);
        assert.equal(query.pageToken, token);
      });
    });

    it('should pass error if api returns an error', function() {
      var error = new Error('Error');
      pubsub.request = function(protoOpts, reqOpts, callback) {
        callback(error);
      };
      pubsub.getTopics(function(err) {
        assert.equal(err, error);
      });
    });

    it('should pass apiResponse to callback', function(done) {
      var resp = { success: true };
      pubsub.request = function(protoOpts, reqOpts, callback) {
        callback(null, resp);
      };
      pubsub.getTopics(function(err, topics, nextQuery, apiResponse) {
        assert.equal(resp, apiResponse);
        done();
      });
    });
  });

  describe('subscribe', function() {
    var TOPIC_NAME = 'topic';
    var TOPIC = {
      name: 'projects/' + PROJECT_ID + '/topics/' + TOPIC_NAME
    };

    var SUB_NAME = 'subscription';
    var SUBSCRIPTION = {
      name: 'projects/' + PROJECT_ID + '/subscriptions/' + SUB_NAME
    };

    var apiResponse = {
      name: 'subscription-name'
    };

    it('should throw if no Topic is provided', function() {
      assert.throws(function() {
        pubsub.subscribe();
      }, /A Topic is required for a new subscription\./);
    });

    it('should throw if no sub name is provided', function() {
      assert.throws(function() {
        pubsub.subscribe('topic');
      }, /A subscription name is required for a new subscription\./);
    });

    it('should not require configuration options', function(done) {
      pubsub.request = function(protoOpts, reqOpts, callback) {
        callback(null, apiResponse);
      };

      pubsub.subscribe(TOPIC_NAME, SUB_NAME, done);
    });

    it('should allow undefined/optional configuration options', function(done) {
      pubsub.request = function(protoOpts, reqOpts, callback) {
        callback(null, apiResponse);
      };

      pubsub.subscribe(TOPIC_NAME, SUB_NAME, undefined, done);
    });

    it('should create a Subscription', function(done) {
      var opts = { a: 'b', c: 'd' };

      pubsub.request = util.noop;

      pubsub.subscription = function(subName, options) {
        assert.strictEqual(subName, SUB_NAME);
        assert.deepEqual(options, opts);
        setImmediate(done);
        return SUBSCRIPTION;
      };

      pubsub.subscribe(TOPIC_NAME, SUB_NAME, opts, assert.ifError);
    });

    it('should create a Topic object from a string', function(done) {
      pubsub.request = util.noop;

      pubsub.topic = function(topicName) {
        assert.strictEqual(topicName, TOPIC_NAME);
        setImmediate(done);
        return TOPIC;
      };

      pubsub.subscribe(TOPIC_NAME, SUB_NAME, assert.ifError);
    });

    it('should send correct request', function(done) {
      pubsub.topic = function(topicName) {
        return {
          name: topicName
        };
      };

      pubsub.subscription = function(subName) {
        return {
          name: subName
        };
      };

      pubsub.request = function(protoOpts, reqOpts) {
        assert.strictEqual(protoOpts.service, 'Subscriber');
        assert.strictEqual(protoOpts.method, 'createSubscription');
        assert.strictEqual(protoOpts.timeout, pubsub.timeout);
        assert.strictEqual(reqOpts.topic, TOPIC_NAME);
        assert.strictEqual(reqOpts.name, SUB_NAME);
        done();
      };

      pubsub.subscribe(TOPIC_NAME, SUB_NAME, assert.ifError);
    });

    it('should pass options to the api request', function(done) {
      var options = {
        ackDeadlineSeconds: 90,
        autoAck: true,
        encoding: 'utf-8',
        interval: 3,
        maxInProgress: 5,
        pushEndpoint: 'https://domain/push',
        reuseExisting: false,
        timeout: 30000
      };

      var expectedBody = extend({
        topic: TOPIC_NAME,
        name: SUB_NAME
      }, options, {
        pushConfig: {
          pushEndpoint: options.pushEndpoint
        }
      });

      delete expectedBody.autoAck;
      delete expectedBody.encoding;
      delete expectedBody.interval;
      delete expectedBody.maxInProgress;
      delete expectedBody.pushEndpoint;
      delete expectedBody.reuseExisting;
      delete expectedBody.timeout;

      pubsub.topic = function() {
        return {
          name: TOPIC_NAME
        };
      };

      pubsub.subscription = function() {
        return {
          name: SUB_NAME
        };
      };

      pubsub.request = function(protoOpts, reqOpts) {
        assert.notStrictEqual(reqOpts, options);
        assert.deepEqual(reqOpts, expectedBody);
        done();
      };

      pubsub.subscribe(TOPIC_NAME, SUB_NAME, options, assert.ifError);
    });

    describe('error', function() {
      var error = new Error('Error.');
      var apiResponse = { name: SUB_NAME };

      beforeEach(function() {
        pubsub.request = function(protoOpts, reqOpts, callback) {
          callback(error, apiResponse);
        };
      });

      it('should re-use existing subscription if specified', function(done) {
        var apiResponse = { code: 409 };

        pubsub.subscription = function() {
          return SUBSCRIPTION;
        };

        pubsub.request = function(protoOpts, reqOpts, callback) {
          callback({ code: 409 }, apiResponse);
        };

        // Don't re-use an existing subscription (error if one exists).
        pubsub.subscribe(TOPIC_NAME, SUB_NAME, function(err, sub, resp) {
          assert.equal(err.code, 409);
          assert.strictEqual(resp, apiResponse);
        });

        // Re-use an existing subscription (ignore error if one exists).
        var opts = { reuseExisting: true };
        pubsub.subscribe(TOPIC_NAME, SUB_NAME, opts, function(err, sub) {
          assert.ifError(err);
          assert.deepEqual(sub, SUBSCRIPTION);

          done();
        });
      });

      it('should return error & API response to the callback', function(done) {
        pubsub.request = function(protoOpts, reqOpts, callback) {
          callback(error, apiResponse);
        };

        pubsub.subscribe(TOPIC_NAME, SUB_NAME, function(err, sub, resp) {
          assert.strictEqual(err, error);
          assert.strictEqual(sub, null);
          assert.strictEqual(resp, apiResponse);
          done();
        });
      });
    });

    describe('success', function() {
      var apiResponse = { name: SUB_NAME };

      beforeEach(function() {
        pubsub.request = function(protoOpts, reqOpts, callback) {
          callback(null, apiResponse);
        };
      });

      it('should return Subscription & resp to the callback', function(done) {
        var subscription = {};

        pubsub.subscription = function() {
          return subscription;
        };

        pubsub.request = function(protoOpts, reqOpts, callback) {
          callback(null, apiResponse);
        };

        pubsub.subscribe(TOPIC_NAME, SUB_NAME, function(err, sub, resp) {
          assert.ifError(err);
          assert.strictEqual(sub, subscription);
          assert.strictEqual(resp, apiResponse);
          done();
        });
      });
    });
  });

  describe('subscription', function() {
    var SUB_NAME = 'new-sub-name';
    var CONFIG = { autoAck: true, interval: 90 };

    it('should throw if no name is provided', function() {
      assert.throws(function() {
        pubsub.subscription();
      }, /The name of a subscription is required\./);
    });

    it('should return a Subscription object', function() {
      SubscriptionOverride = function() {};
      var subscription = pubsub.subscription(SUB_NAME, {});
      assert(subscription instanceof SubscriptionOverride);
    });

    it('should honor settings', function(done) {
      SubscriptionOverride = function(pubsub, options) {
        assert.deepEqual(options, CONFIG);
        done();
      };
      pubsub.subscription(SUB_NAME, CONFIG);
    });

    it('should pass specified name to the Subscription', function(done) {
      SubscriptionOverride = function(pubsub, options) {
        assert.equal(options.name, SUB_NAME);
        done();
      };
      pubsub.subscription(SUB_NAME, {});
    });

    it('should not require options', function() {
      assert.doesNotThrow(function() {
        pubsub.subscription(SUB_NAME);
      });
    });
  });

  describe('topic', function() {
    it('should throw if a name is not provided', function() {
      assert.throws(function() {
        pubsub.topic();
      }, /A name must be specified for a new topic\./);
    });

    it('should return a Topic object', function() {
      assert(pubsub.topic('new-topic') instanceof Topic);
    });
  });

  describe('determineBaseUrl_', function() {
    function setHost(host) {
      process.env.PUBSUB_EMULATOR_HOST = host;
    }

    beforeEach(function() {
      delete process.env.PUBSUB_EMULATOR_HOST;
    });

    it('should default to defaultBaseUrl_', function() {
      var defaultBaseUrl_ = 'defaulturl';
      pubsub.defaultBaseUrl_ = defaultBaseUrl_;

      pubsub.determineBaseUrl_();
      assert.strictEqual(pubsub.baseUrl_, defaultBaseUrl_);
    });

    it('should remove slashes from the baseUrl', function() {
      var expectedBaseUrl = 'localhost:8080';

      setHost('localhost:8080/');
      pubsub.determineBaseUrl_();
      assert.strictEqual(pubsub.baseUrl_, expectedBaseUrl);

      setHost('localhost:8080//');
      pubsub.determineBaseUrl_();
      assert.strictEqual(pubsub.baseUrl_, expectedBaseUrl);
    });

    it('should remove the protocol if specified', function() {
      setHost('http://localhost:8080');
      pubsub.determineBaseUrl_();
      assert.strictEqual(pubsub.baseUrl_, 'localhost:8080');

      setHost('https://localhost:8080');
      pubsub.determineBaseUrl_();
      assert.strictEqual(pubsub.baseUrl_, 'localhost:8080');
    });

    it('should not set customEndpoint_ when using default baseurl', function() {
      var pubsub = new PubSub({ projectId: PROJECT_ID });
      pubsub.determineBaseUrl_();
      assert.strictEqual(pubsub.customEndpoint_, undefined);
    });

    describe('with PUBSUB_EMULATOR_HOST environment variable', function() {
      var PUBSUB_EMULATOR_HOST = 'localhost:9090';

      beforeEach(function() {
        setHost(PUBSUB_EMULATOR_HOST);
      });

      after(function() {
        delete process.env.PUBSUB_EMULATOR_HOST;
      });

      it('should use the PUBSUB_EMULATOR_HOST env var', function() {
        pubsub.determineBaseUrl_();
        assert.strictEqual(pubsub.baseUrl_, PUBSUB_EMULATOR_HOST);
      });

      it('should set customEndpoint_', function() {
        pubsub.determineBaseUrl_();
        assert.strictEqual(pubsub.customEndpoint_, true);
      });
    });
  });
});
