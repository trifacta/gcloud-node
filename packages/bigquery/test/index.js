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
var nodeutil = require('util');
var proxyquire = require('proxyquire');

var Service = require('@google-cloud/common').Service;
var Table = require('../src/table.js');
var util = require('@google-cloud/common').util;

var promisified = false;
var fakeUtil = extend({}, util, {
  promisifyAll: function(Class, options) {
    if (Class.name !== 'BigQuery') {
      return;
    }

    promisified = true;
    assert.deepEqual(options.exclude, ['dataset', 'job']);
  }
});

function FakeTable(a, b) {
  Table.call(this, a, b);
}

var mergeSchemaWithRowsOverride;
FakeTable.mergeSchemaWithRows_ = function() {
  var args = [].slice.apply(arguments);
  return (mergeSchemaWithRowsOverride || Table.mergeSchemaWithRows_)
    .apply(null, args);
};

var extended = false;
var fakePaginator = {
  extend: function(Class, methods) {
    if (Class.name !== 'BigQuery') {
      return;
    }

    methods = arrify(methods);
    assert.equal(Class.name, 'BigQuery');
    assert.deepEqual(methods, ['getDatasets', 'getJobs', 'query']);
    extended = true;
  },
  streamify: function(methodName) {
    return methodName;
  }
};

function FakeService() {
  this.calledWith_ = arguments;
  Service.apply(this, arguments);
}

nodeutil.inherits(FakeService, Service);

describe('BigQuery', function() {
  var JOB_ID = 'JOB_ID';
  var PROJECT_ID = 'test-project';

  var BigQuery;
  var bq;

  before(function() {
    BigQuery = proxyquire('../', {
      './table.js': FakeTable,
      '@google-cloud/common': {
        Service: FakeService,
        paginator: fakePaginator,
        util: fakeUtil
      }
    });
  });

  beforeEach(function() {
    bq = new BigQuery({ projectId: PROJECT_ID });
  });

  describe('instantiation', function() {
    it('should extend the correct methods', function() {
      assert(extended); // See `fakePaginator.extend`
    });

    it('should streamify the correct methods', function() {
      assert.strictEqual(bq.getDatasetsStream, 'getDatasets');
      assert.strictEqual(bq.getJobsStream, 'getJobs');
      assert.strictEqual(bq.createQueryStream, 'query');
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

      BigQuery.call(fakeContext, fakeOptions);
      assert(normalizeArgumentsCalled);

      fakeUtil.normalizeArguments = normalizeArguments;
    });

    it('should inherit from Service', function() {
      assert(bq instanceof Service);

      var calledWith = bq.calledWith_[0];

      var baseUrl = 'https://www.googleapis.com/bigquery/v2';
      assert.strictEqual(calledWith.baseUrl, baseUrl);
      assert.deepEqual(calledWith.scopes, [
        'https://www.googleapis.com/auth/bigquery'
      ]);
      assert.deepEqual(calledWith.packageJson, require('../package.json'));
    });
  });

  describe('createDataset', function() {
    var DATASET_ID = 'kittens';

    it('should create a dataset', function(done) {
      bq.request = function(reqOpts) {
        assert.strictEqual(reqOpts.method, 'POST');
        assert.strictEqual(reqOpts.uri, '/datasets');
        assert.deepEqual(reqOpts.json, {
          datasetReference: {
            datasetId: DATASET_ID
          }
        });

        done();
      };

      bq.createDataset(DATASET_ID, assert.ifError);
    });

    it('should not modify the original options object', function(done) {
      var options = {
        a: 'b',
        c: 'd'
      };

      var originalOptions = extend({}, options);

      bq.request = function(reqOpts) {
        assert.notStrictEqual(reqOpts.json, options);
        assert.deepEqual(options, originalOptions);
        done();
      };

      bq.createDataset(DATASET_ID, options, assert.ifError);
    });

    it('should return an error to the callback', function(done) {
      var error = new Error('Error.');

      bq.request = function(reqOpts, callback) {
        callback(error);
      };

      bq.createDataset(DATASET_ID, function(err) {
        assert.equal(err, error);
        done();
      });
    });

    it('should return a Dataset object', function(done) {
      bq.request = function(reqOpts, callback) {
        callback(null, {});
      };

      bq.createDataset(DATASET_ID, function(err, dataset) {
        assert.ifError(err);
        assert.equal(dataset.constructor.name, 'Dataset');
        done();
      });
    });

    it('should return an apiResponse', function(done) {
      var resp = { success: true };

      bq.request = function(reqOpts, callback) {
        callback(null, resp);
      };

      bq.createDataset(DATASET_ID, function(err, dataset, apiResponse) {
        assert.ifError(err);
        assert.deepEqual(apiResponse, resp);
        done();
      });
    });

    it('should assign metadata to the Dataset object', function(done) {
      var metadata = { a: 'b', c: 'd' };

      bq.request = function(reqOpts, callback) {
        callback(null, metadata);
      };

      bq.createDataset(DATASET_ID, function(err, dataset) {
        assert.ifError(err);
        assert.deepEqual(dataset.metadata, metadata);
        done();
      });
    });
  });

  describe('dataset', function() {
    var DATASET_ID = 'dataset-id';

    it('returns a Dataset instance', function() {
      var ds = bq.dataset(DATASET_ID);
      assert.equal(ds.constructor.name, 'Dataset');
    });

    it('should scope the correct dataset', function() {
      var ds = bq.dataset(DATASET_ID);
      assert.equal(ds.id, DATASET_ID);
      assert.deepEqual(ds.bigQuery, bq);
    });
  });

  describe('getDatasets', function() {
    it('should get datasets from the api', function(done) {
      bq.request = function(reqOpts) {
        assert.strictEqual(reqOpts.uri, '/datasets');
        assert.deepEqual(reqOpts.qs, {});

        done();
      };

      bq.getDatasets(assert.ifError);
    });

    it('should accept query', function(done) {
      var queryObject = { all: true, maxResults: 8, pageToken: 'token' };

      bq.request = function(reqOpts) {
        assert.strictEqual(reqOpts.qs, queryObject);
        done();
      };

      bq.getDatasets(queryObject, assert.ifError);
    });

    it('should return error to callback', function(done) {
      var error = new Error('Error.');

      bq.request = function(reqOpts, callback) {
        callback(error);
      };

      bq.getDatasets(function(err) {
        assert.strictEqual(err, error);
        done();
      });
    });

    it('should return Dataset objects', function(done) {
      bq.request = function(reqOpts, callback) {
        callback(null, {
          datasets: [{ datasetReference: { datasetId: 'datasetName' } }]
        });
      };

      bq.getDatasets(function(err, datasets) {
        assert.ifError(err);
        assert.strictEqual(datasets[0].constructor.name, 'Dataset');
        done();
      });
    });

    it('should return Dataset objects', function(done) {
      var resp = { success: true };

      bq.request = function(reqOpts, callback) {
        callback(null, resp);
      };

      bq.getDatasets(function(err, datasets, nextQuery, apiResponse) {
        assert.ifError(err);
        assert.strictEqual(apiResponse, resp);
        done();
      });
    });

    it('should assign metadata to the Dataset objects', function(done) {
      var datasetObjects = [
        {
          a: 'b',
          c: 'd',
          datasetReference: {
            datasetId: 'datasetName'
          }
        }
      ];

      bq.request = function(reqOpts, callback) {
        callback(null, { datasets: datasetObjects });
      };

      bq.getDatasets(function(err, datasets) {
        assert.ifError(err);
        assert.strictEqual(datasets[0].metadata, datasetObjects[0]);
        done();
      });
    });

    it('should return token if more results exist', function(done) {
      var token = 'token';

      bq.request = function(reqOpts, callback) {
        callback(null, { nextPageToken: token });
      };

      bq.getDatasets(function(err, datasets, nextQuery) {
        assert.deepEqual(nextQuery, {
          pageToken: token
        });
        done();
      });
    });
  });

  describe('getJobs', function() {
    it('should get jobs from the api', function(done) {
      bq.request = function(reqOpts) {
        assert.equal(reqOpts.uri, '/jobs');
        assert.deepEqual(reqOpts.qs, {});

        done();
      };

      bq.getJobs(assert.ifError);
    });

    it('should accept query', function(done) {
      var queryObject = {
        allUsers: true,
        maxResults: 8,
        pageToken: 'token',
        projection: 'full',
        stateFilter: 'done'
      };

      bq.request = function(reqOpts) {
        assert.deepEqual(reqOpts.qs, queryObject);
        done();
      };

      bq.getJobs(queryObject, assert.ifError);
    });

    it('should return error to callback', function(done) {
      var error = new Error('Error.');

      bq.request = function(reqOpts, callback) {
        callback(error);
      };

      bq.getJobs(function(err) {
        assert.strictEqual(err, error);
        done();
      });
    });

    it('should return Job objects', function(done) {
      bq.request = function(reqOpts, callback) {
        callback(null, { jobs: [{ id: JOB_ID }] });
      };

      bq.getJobs(function(err, jobs) {
        assert.ifError(err);
        assert.strictEqual(jobs[0].constructor.name, 'Job');
        done();
      });
    });

    it('should return apiResponse', function(done) {
      var resp = { jobs: [{ id: JOB_ID }] };

      bq.request = function(reqOpts, callback) {
        callback(null, resp);
      };

      bq.getJobs(function(err, jobs, nextQuery, apiResponse) {
        assert.ifError(err);
        assert.strictEqual(resp, apiResponse);
        done();
      });
    });

    it('should assign metadata to the Job objects', function(done) {
      var jobObjects = [{ a: 'b', c: 'd', id: JOB_ID }];

      bq.request = function(reqOpts, callback) {
        callback(null, { jobs: jobObjects });
      };

      bq.getJobs(function(err, jobs) {
        assert.ifError(err);
        assert.strictEqual(jobs[0].metadata, jobObjects[0]);
        done();
      });
    });

    it('should return token if more results exist', function(done) {
      var token = 'token';

      bq.request = function(reqOpts, callback) {
        callback(null, { nextPageToken: token });
      };

      bq.getJobs(function(err, jobs, nextQuery) {
        assert.ifError(err);
        assert.deepEqual(nextQuery, {
          pageToken: token
        });
        done();
      });
    });
  });

  describe('job', function() {
    it('should return a Job instance', function() {
      var job = bq.job(JOB_ID);
      assert.equal(job.constructor.name, 'Job');
    });

    it('should scope the correct job', function() {
      var job = bq.job(JOB_ID);
      assert.equal(job.id, JOB_ID);
      assert.deepEqual(job.bigQuery, bq);
    });
  });

  describe('query', function() {
    var QUERY_STRING = 'SELECT * FROM [dataset.table]';

    it('should accept a string for a query', function(done) {
      bq.request = function(reqOpts) {
        assert.strictEqual(reqOpts.json.query, QUERY_STRING);
        done();
      };

      bq.query(QUERY_STRING, assert.ifError);
    });

    it('should pass along query options', function(done) {
      var options = {
        query: QUERY_STRING,
        a: 'b',
        c: 'd'
      };

      bq.request = function(reqOpts) {
        assert.strictEqual(reqOpts.json, options);
        done();
      };

      bq.query(options, assert.ifError);
    });

    it('should get the results of a job if one is provided', function(done) {
      var options = {
        job: bq.job(JOB_ID),
        maxResults: 10,
        timeoutMs: 8
      };

      var expectedRequestQuery = {
        maxResults: 10,
        timeoutMs: 8
      };

      bq.request = function(reqOpts) {
        assert.strictEqual(reqOpts.uri, '/queries/' + JOB_ID);
        assert.deepEqual(reqOpts.qs, expectedRequestQuery);
        done();
      };

      bq.query(options, assert.ifError);
    });

    describe('job is incomplete', function() {
      var options = {};

      beforeEach(function() {
        bq.request = function(reqOpts, callback) {
          callback(null, {
            jobComplete: false,
            jobReference: { jobId: JOB_ID }
          });
        };
      });

      it('should populate nextQuery when job is incomplete', function(done) {
        bq.query({}, function(err, rows, nextQuery) {
          assert.ifError(err);
          assert.equal(nextQuery.job.constructor.name, 'Job');
          assert.equal(nextQuery.job.id, JOB_ID);
          done();
        });
      });

      it('should return apiResponse', function(done) {
        bq.query({}, function(err, rows, nextQuery, apiResponse) {
          assert.ifError(err);
          assert.deepEqual(apiResponse, {
            jobComplete: false,
            jobReference: { jobId: JOB_ID }
          });
          done();
        });
      });

      it('should not modify original options object', function(done) {
        bq.query(options, function(err) {
          assert.ifError(err);
          assert.deepEqual(options, {});
          done();
        });
      });
    });

    describe('more results exist', function() {
      var options = {};
      var pageToken = 'token';

      beforeEach(function() {
        bq.request = function(reqOpts, callback) {
          callback(null, {
            pageToken: pageToken,
            jobReference: { jobId: JOB_ID }
          });
        };
      });

      it('should populate nextQuery when more results exist', function(done) {
        bq.query(options, function(err, rows, nextQuery) {
          assert.ifError(err);
          assert.equal(nextQuery.job.constructor.name, 'Job');
          assert.equal(nextQuery.job.id, JOB_ID);
          assert.equal(nextQuery.pageToken, pageToken);
          done();
        });
      });

      it('should not modify original options object', function(done) {
        bq.query(options, function(err) {
          assert.ifError(err);
          assert.deepEqual(options, {});
          done();
        });
      });
    });

    it('should merge the schema with rows', function(done) {
      var rows = [{ row: 'a' }, { row: 'b' }, { row: 'c' }];
      var schema = [{ fields: [] }];

      mergeSchemaWithRowsOverride = function(s, r) {
        mergeSchemaWithRowsOverride = null;
        assert.deepEqual(s, schema);
        assert.deepEqual(r, rows);
        done();
      };

      bq.request = function(reqOpts, callback) {
        callback(null, {
          jobReference: { jobId: JOB_ID },
          rows: rows,
          schema: schema
        });
      };

      bq.query({}, assert.ifError);
    });

    it('should pass errors to the callback', function(done) {
      var error = new Error('Error.');

      bq.request = function(reqOpts, callback) {
        callback(error);
      };

      bq.query({}, function(err) {
        assert.equal(err, error);
        done();
      });
    });

    it('should return rows to the callback', function(done) {
      var ROWS = [{ a: 'b' }, { c: 'd' }];

      bq.request = function(reqOpts, callback) {
        callback(null, {
          jobReference: { jobId: JOB_ID },
          rows: [],
          schema: {}
        });
      };

      mergeSchemaWithRowsOverride = function() {
        mergeSchemaWithRowsOverride = null;
        return ROWS;
      };

      bq.query({}, function(err, rows) {
        assert.deepEqual(rows, ROWS);
        done();
      });
    });
  });

  describe('startQuery', function() {
    it('should throw if a query is not provided', function() {
      assert.throws(function() {
        bq.startQuery();
      }, /SQL query string is required/);

      assert.throws(function() {
        bq.startQuery({ noQuery: 'here' });
      }, /SQL query string is required/);
    });

    describe('with destination', function() {
      var dataset;
      var TABLE_ID = 'table-id';

      beforeEach(function() {
        dataset = {
          bigQuery: bq,
          id: 'dataset-id',
          createTable: util.noop
        };
      });

      it('should throw if a destination table is not provided', function() {
        assert.throws(function() {
          bq.startQuery({
            query: 'query',
            destination: 'not a table'
          });
        }, /Destination must be a Table/);
      });

      it('should assign destination table to request body', function(done) {
        bq.request = function(reqOpts) {
          assert.deepEqual(reqOpts.json.configuration.query.destinationTable, {
            datasetId: dataset.id,
            projectId: dataset.bigQuery.projectId,
            tableId: TABLE_ID
          });

          done();
        };

        bq.startQuery({
          query: 'query',
          destination: new FakeTable(dataset, TABLE_ID)
        });
      });

      it('should delete `destination` prop from request body', function(done) {
        bq.request = function(reqOpts) {
          var body = reqOpts.json;
          assert.strictEqual(body.configuration.query.destination, undefined);
          done();
        };

        bq.startQuery({
          query: 'query',
          destination: new FakeTable(dataset, TABLE_ID)
        });
      });
    });

    it('should pass options to the request body', function(done) {
      var options = { a: 'b', c: 'd', query: 'query' };

      bq.request = function(reqOpts) {
        assert.deepEqual(reqOpts.json.configuration.query, options);
        done();
      };

      bq.startQuery(options);
    });

    it('should make the correct api request', function(done) {
      bq.request = function(reqOpts) {
        assert.equal(reqOpts.method, 'POST');
        assert.equal(reqOpts.uri, '/jobs');
        assert.deepEqual(reqOpts.json.configuration.query, { query: 'query' });
        done();
      };

      bq.startQuery('query');
    });

    it('should execute the callback with error', function(done) {
      var error = new Error('Error.');

      bq.request = function(reqOpts, callback) {
        callback(error);
      };

      bq.startQuery('query', function(err) {
        assert.equal(err, error);
        done();
      });
    });

    it('should execute the callback with Job', function(done) {
      var jobsResource = { jobReference: { jobId: JOB_ID }, a: 'b', c: 'd' };

      bq.request = function(reqOpts, callback) {
        callback(null, jobsResource);
      };

      bq.startQuery('query', function(err, job) {
        assert.ifError(err);
        assert.equal(job.constructor.name, 'Job');
        assert.equal(job.id, JOB_ID);
        assert.deepEqual(job.metadata, jobsResource);
        done();
      });
    });

    it('should execute the callback with apiResponse', function(done) {
      var jobsResource = { jobReference: { jobId: JOB_ID }, a: 'b', c: 'd' };

      bq.request = function(reqOpts, callback) {
        callback(null, jobsResource);
      };

      bq.startQuery('query', function(err, job, apiResponse) {
        assert.ifError(err);
        assert.deepEqual(apiResponse, jobsResource);
        done();
      });
    });
  });
});
