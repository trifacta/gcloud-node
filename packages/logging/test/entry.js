/**
 * Copyright 2015 Google Inc. All Rights Reserved.
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

var assert = require('assert');
var extend = require('extend');
var GrpcService = require('@google-cloud/common').GrpcService;
var proxyquire = require('proxyquire');

function FakeGrpcService() {}

describe('Entry', function() {
  var Entry;
  var entry;

  var METADATA = {};
  var DATA = {};

  before(function() {
    Entry = proxyquire('../src/entry.js', {
      '@google-cloud/common': {
        GrpcService: FakeGrpcService
      }
    });
  });

  beforeEach(function() {
    extend(FakeGrpcService, GrpcService);
    entry = new Entry(METADATA, DATA);
  });

  describe('instantiation', function() {
    it('should localize metadata and data', function() {
      assert.strictEqual(entry.metadata, METADATA);
      assert.strictEqual(entry.data, DATA);
    });
  });

  describe('fromApiResponse_', function() {
    var RESOURCE = {};
    var entry;
    var date = new Date();

    beforeEach(function() {
      var seconds = date.getTime() / 1000;
      var secondsRounded = Math.floor(seconds);

      FakeGrpcService.structToObj_ = function(data) {
        return data;
      };

      entry = Entry.fromApiResponse_({
        resource: RESOURCE,
        payload: 'jsonPayload',
        jsonPayload: DATA,
        extraProperty: true,
        timestamp: {
          seconds: secondsRounded,
          nanos: Math.floor((seconds - secondsRounded) * 1e9)
        }
      });
    });

    it('should create an Entry', function() {
      assert(entry instanceof Entry);
      assert.strictEqual(entry.metadata.resource, RESOURCE);
      assert.strictEqual(entry.data, DATA);
      assert.strictEqual(entry.metadata.extraProperty, true);
      assert.deepEqual(entry.metadata.timestamp, date);
    });

    it('should extend the entry with proto data', function() {
      var entry = Entry.fromApiResponse_({
        resource: RESOURCE,
        payload: 'protoPayload',
        protoPayload: DATA,
        extraProperty: true
      });

      assert.strictEqual(entry.data, DATA);
    });

    it('should extend the entry with json data', function() {
      assert.strictEqual(entry.data, DATA);
    });

    it('should extend the entry with text data', function() {
      var entry = Entry.fromApiResponse_({
        resource: RESOURCE,
        payload: 'textPayload',
        textPayload: DATA,
        extraProperty: true
      });

      assert.strictEqual(entry.data, DATA);
    });
  });

  describe('toJSON', function() {
    it('should not modify the original instance', function() {
      var entryBefore = extend(true, {}, entry);
      entry.toJSON();
      var entryAfter = extend(true, {}, entry);
      assert.deepEqual(entryBefore, entryAfter);
    });

    it('should convert data as a struct and assign to jsonPayload', function() {
      var input = {};
      var converted = {};

      FakeGrpcService.objToStruct_ = function(obj, options) {
        assert.strictEqual(obj, input);
        assert.deepEqual(options, {
          stringify: true
        });
        return converted;
      };

      entry.data = input;
      var json = entry.toJSON();
      assert.strictEqual(json.jsonPayload, converted);
    });

    it('should throw with a struct with a circular reference', function() {
      entry.data = { val: true };
      entry.data.data = entry.data;

      assert.throws(function() {
        entry.toJSON();
      }, /The JSON data for this entry has a circular reference\./);
    });

    it('should assign string data as textPayload', function() {
      entry.data = 'string';
      var json = entry.toJSON();
      assert.strictEqual(json.textPayload, entry.data);
    });

    it('should convert a date', function() {
      var date = new Date();
      entry.metadata.timestamp = date;

      var json = entry.toJSON();

      var seconds = date.getTime() / 1000;
      var secondsRounded = Math.floor(seconds);

      assert.deepEqual(json.timestamp, {
        seconds: secondsRounded,
        nanos: Math.floor((seconds - secondsRounded) * 1e9)
      });
    });
  });
});
