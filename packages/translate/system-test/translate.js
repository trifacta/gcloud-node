/*!
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
var prop = require('propprop');

var env = require('../../../system-test/env.js');
var Translate = require('../');

var API_KEY = process.env.GCLOUD_TESTS_API_KEY;

// Only run the tests if there is an API key to test with.
(API_KEY ? describe : describe.skip)('translate', function() {
  if (!API_KEY) {
    // The test runner still executes this function, even if it is skipped.
    return;
  }

  var translate = new Translate(extend({}, env, { key: API_KEY }));

  describe('detecting language from input', function() {
    var INPUT = [
      {
        input: 'Hello!',
        expectedLanguage: 'en'
      },
      {
        input: '¡Hola!',
        expectedLanguage: 'es'
      }
    ];

    it('should detect a langauge', function(done) {
      var input = INPUT.map(prop('input'));

      translate.detect(input, function(err, results) {
        assert.ifError(err);
        assert.strictEqual(results[0].language, INPUT[0].expectedLanguage);
        assert.strictEqual(results[1].language, INPUT[1].expectedLanguage);
        done();
      });
    });
  });

  describe('translations', function() {
    var INPUT = [
      {
        input: 'Hello!',
        expectedTranslation: '¡Hola!'
      },
      {
        input: 'How are you today?',
        expectedTranslation: '¿Cómo estás hoy?'
      }
    ];

    it('should translate input', function(done) {
      var input = INPUT.map(prop('input'));

      translate.translate(input, 'es', function(err, results) {
        assert.ifError(err);
        assert.strictEqual(results[0], INPUT[0].expectedTranslation);
        assert.strictEqual(results[1], INPUT[1].expectedTranslation);
        done();
      });
    });

    it('should translate input with from and to options', function(done) {
      var input = INPUT.map(prop('input'));

      var opts = {
        from: 'en',
        to: 'es'
      };

      translate.translate(input, opts, function(err, results) {
        assert.ifError(err);
        assert.strictEqual(results[0], INPUT[0].expectedTranslation);
        assert.strictEqual(results[1], INPUT[1].expectedTranslation);
        done();
      });
    });

    it('should autodetect HTML', function(done) {
      var input = '<body>' + INPUT[0].input + '</body>';
      var expectedTranslation = [
        '<body>',
        INPUT[0].expectedTranslation,
        '</body>'
      ].join(' ');

      var opts = {
        from: 'en',
        to: 'es'
      };

      translate.translate(input, opts, function(err, results) {
        assert.ifError(err);
        assert.strictEqual(results, expectedTranslation);
        done();
      });
    });
  });

  describe('supported languages', function() {
    it('should get a list of supported languages', function(done) {
      translate.getLanguages(function(err, languages) {
        assert.ifError(err);

        var englishResult = languages.filter(function(language) {
          return language.code === 'en';
        })[0];

        assert.deepEqual(englishResult, {
          code: 'en',
          name: 'English'
        });

        done();
      });
    });

    it('should accept a target language', function(done) {
      translate.getLanguages('es', function(err, languages) {
        assert.ifError(err);

        var englishResult = languages.filter(function(language) {
          return language.code === 'en';
        })[0];

        assert.deepEqual(englishResult, {
          code: 'en',
          name: 'inglés'
        });

        done();
      });
    });
  });
});
