/**
 * Copyright 2016 Google Inc. All Rights Reserved.
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
var proxyquire = require('proxyquire');
var util = require('@google-cloud/common').util;

var isCustomTypeOverride;
var promisified = false;
var fakeUtil = extend(true, {}, util, {
  isCustomType: function() {
    if (isCustomTypeOverride) {
      return isCustomTypeOverride.apply(null, arguments);
    }

    return false;
  },
  promisifyAll: function(Class) {
    if (Class.name === 'Document') {
      promisified = true;
    }
  }
});

describe('Document', function() {
  var DocumentCache;
  var Document;
  var document;

  var LANGUAGE = {
    api: {}
  };
  var CONFIG = 'inline content';

  before(function() {
    Document = proxyquire('../src/document.js', {
      '@google-cloud/common': {
        util: fakeUtil
      }
    });

    DocumentCache = extend(true, {}, Document);
  });

  beforeEach(function() {
    isCustomTypeOverride = null;

    for (var property in DocumentCache) {
      if (DocumentCache.hasOwnProperty(property)) {
        Document[property] = DocumentCache[property];
      }
    }

    document = new Document(LANGUAGE, CONFIG);
  });

  describe('instantiation', function() {
    it('should expose the gax API', function() {
      assert.strictEqual(document.api, LANGUAGE.api);
    });

    it('should promisify all the things', function() {
      assert(promisified);
    });

    it('should set the correct document for inline content', function() {
      assert.deepEqual(document.document, {
        content: CONFIG,
        type: 'PLAIN_TEXT'
      });
    });

    it('should set and uppercase the correct encodingType', function() {
      var document = new Document(LANGUAGE, {
        content: CONFIG,
        encoding: 'utf-8'
      });

      assert.strictEqual(document.encodingType, 'UTF8');
    });

    it('should set the correct document for content with language', function() {
      var document = new Document(LANGUAGE, {
        content: CONFIG,
        language: 'EN'
      });

      assert.strictEqual(document.document.language, 'EN');
    });

    it('should set the correct document for content with type', function() {
      var document = new Document(LANGUAGE, {
        content: CONFIG,
        type: 'html'
      });

      assert.strictEqual(document.document.type, 'HTML');
    });

    it('should set the correct document for text', function() {
      var document = new Document(LANGUAGE, {
        content: CONFIG,
        type: 'text'
      });

      assert.deepEqual(document.document, {
        content: CONFIG,
        type: 'PLAIN_TEXT'
      });
    });

    it('should set the GCS content URI from a File', function() {
      var file = {
        // Leave spaces in to check that it is URI-encoded:
        id: 'file name',
        bucket: {
          id: 'bucket name'
        }
      };

      isCustomTypeOverride = function(content, type) {
        assert.strictEqual(content, file);
        assert.strictEqual(type, 'storage/file');
        return true;
      };

      var document = new Document(LANGUAGE, {
        content: file
      });

      assert.deepEqual(document.document.gcsContentUri, [
        'gs://',
        encodeURIComponent(file.bucket.id),
        '/',
        encodeURIComponent(file.id),
      ].join(''));
    });
  });

  describe('PART_OF_SPEECH', function() {
    var expectedPartOfSpeech = {
      UNKNOWN: 'Unknown',
      ADJ: 'Adjective',
      ADP: 'Adposition (preposition and postposition)',
      ADV: 'Adverb',
      CONJ: 'Conjunction',
      DET: 'Determiner',
      NOUN: 'Noun (common and proper)',
      NUM: 'Cardinal number',
      PRON: 'Pronoun',
      PRT: 'Particle or other function word',
      PUNCT: 'Punctuation',
      VERB: 'Verb (all tenses and modes)',
      X: 'Other: foreign words, typos, abbreviations',
      AFFIX: 'Affix'
    };

    it('should define the correct parts of speech', function() {
      assert.deepEqual(Document.PART_OF_SPEECH, expectedPartOfSpeech);
    });
  });

  describe('annotate', function() {
    it('should make the correct API request', function(done) {
      document.api.Language = {
        annotateText: function(reqOpts) {
          assert.strictEqual(reqOpts.document, document.document);

          assert.deepEqual(reqOpts.features, {
            extractDocumentSentiment: true,
            extractEntities: true,
            extractSyntax: true
          });

          assert.strictEqual(reqOpts.encodingType, document.encodingType);

          done();
        }
      };

      document.encodingType = 'encoding-type';
      document.annotate(assert.ifError);
    });

    it('should allow specifying individual features', function(done) {
      document.api.Language = {
        annotateText: function(reqOpts) {
          assert.deepEqual(reqOpts.features, {
            extractDocumentSentiment: false,
            extractEntities: true,
            extractSyntax: true
          });

          done();
        }
      };

      document.annotate({
        entities: true,
        syntax: true
      }, assert.ifError);
    });

    describe('error', function() {
      var apiResponse = {};
      var error = new Error('Error.');

      beforeEach(function() {
        document.api.Language = {
          annotateText: function(options, callback) {
            callback(error, apiResponse);
          }
        };
      });

      it('should exec callback with error and API response', function(done) {
        document.annotate(function(err, annotation, apiResponse_) {
          assert.strictEqual(err, error);
          assert.strictEqual(annotation, null);
          assert.strictEqual(apiResponse_, apiResponse);
          done();
        });
      });
    });

    describe('success', function() {
      var apiResponses = {
        default: {
          language: 'EN',
          sentences: [],
          tokens: []
        },

        withSentiment: {
          documentSentiment: {}
        },

        withEntities: {
          entities: []
        },

        withSyntax: {
          sentences: {},
          tokens: {}
        }
      };

      apiResponses.withAll = extend(
        {},
        apiResponses.default,
        apiResponses.withSentiment,
        apiResponses.withEntities,
        apiResponses.withSyntax
      );

      function createAnnotateTextWithResponse(apiResponse) {
        return function(reqOpts, callback) {
          callback(null, apiResponse);
        };
      }

      beforeEach(function() {
        Document.formatSentiment_ = util.noop;
        Document.formatEntities_ = util.noop;
        Document.formatSentences_ = util.noop;
        Document.formatTokens_ = util.noop;
      });

      it('should always return the language', function(done) {
        var apiResponse = apiResponses.default;

        document.api.Language = {
          annotateText: createAnnotateTextWithResponse(apiResponse)
        };

        document.annotate(function(err, annotation, apiResponse_) {
          assert.ifError(err);
          assert.strictEqual(annotation.language, apiResponse.language);
          assert.deepEqual(apiResponse_, apiResponse);
          done();
        });
      });

      it('should return syntax when no features are requested', function(done) {
        var apiResponse = apiResponses.default;

        document.api.Language = {
          annotateText: createAnnotateTextWithResponse(apiResponse)
        };

        var formattedSentences = [];
        Document.formatSentences_ = function(sentences, verbose) {
          assert.strictEqual(sentences, apiResponse.sentences);
          assert.strictEqual(verbose, false);
          return formattedSentences;
        };

        var formattedTokens = [];
        Document.formatTokens_ = function(tokens, verbose) {
          assert.strictEqual(tokens, apiResponse.tokens);
          assert.strictEqual(verbose, false);
          return formattedTokens;
        };

        document.annotate(function(err, annotation, apiResponse_) {
          assert.ifError(err);
          assert.strictEqual(annotation.sentences, formattedSentences);
          assert.strictEqual(annotation.tokens, formattedTokens);
          assert.deepEqual(apiResponse_, apiResponse);
          done();
        });
      });

      it('should return the formatted sentiment if available', function(done) {
        var apiResponse = apiResponses.withSentiment;

        document.api.Language = {
          annotateText: createAnnotateTextWithResponse(apiResponse)
        };

        var formattedSentiment = {};
        Document.formatSentiment_ = function(sentiment, verbose) {
          assert.strictEqual(sentiment, apiResponse.documentSentiment);
          assert.strictEqual(verbose, false);
          return formattedSentiment;
        };

        document.annotate(function(err, annotation, apiResponse_) {
          assert.ifError(err);

          assert.strictEqual(annotation.language, apiResponse.language);
          assert.strictEqual(annotation.sentiment, formattedSentiment);

          assert.deepEqual(apiResponse_, apiResponse);

          done();
        });
      });

      it('should return the formatted entities if available', function(done) {
        var apiResponse = apiResponses.withEntities;

        document.api.Language = {
          annotateText: createAnnotateTextWithResponse(apiResponse)
        };

        var formattedEntities = [];
        Document.formatEntities_ = function(entities, verbose) {
          assert.strictEqual(entities, apiResponse.entities);
          assert.strictEqual(verbose, false);
          return formattedEntities;
        };

        document.annotate(function(err, annotation, apiResponse_) {
          assert.ifError(err);

          assert.strictEqual(annotation.language, apiResponse.language);
          assert.strictEqual(annotation.entities, formattedEntities);

          assert.deepEqual(apiResponse_, apiResponse);

          done();
        });
      });

      it('should not return syntax analyses when not wanted', function(done) {
        var apiResponse = apiResponses.default;

        document.api.Language = {
          annotateText: createAnnotateTextWithResponse(apiResponse)
        };

        document.annotate({
          entities: true,
          sentiment: true
        }, function(err, annotation) {
          assert.ifError(err);

          assert.strictEqual(annotation.sentences, undefined);
          assert.strictEqual(annotation.tokens, undefined);

          done();
        });
      });

      it('should allow verbose mode', function(done) {
        var apiResponse = apiResponses.withAll;

        document.api.Language = {
          annotateText: createAnnotateTextWithResponse(apiResponse)
        };

        var numCallsWithCorrectVerbosityArgument = 0;

        function incrementVerbosityVar(_, verbose) {
          if (verbose === true) {
            numCallsWithCorrectVerbosityArgument++;
          }
        }

        Document.formatSentiment_ = incrementVerbosityVar;
        Document.formatEntities_ = incrementVerbosityVar;
        Document.formatSentences_ = incrementVerbosityVar;
        Document.formatTokens_ = incrementVerbosityVar;

        document.annotate({
          verbose: true
        }, function(err) {
          assert.ifError(err);

          assert.strictEqual(numCallsWithCorrectVerbosityArgument, 4);

          done();
        });
      });
    });
  });

  describe('detectEntities', function() {
    it('should make the correct API request', function(done) {
      document.api.Language = {
        analyzeEntities: function(reqOpts) {
          assert.strictEqual(reqOpts.document, document.document);
          assert.strictEqual(reqOpts.encodingType, document.encodingType);
          done();
        }
      };

      document.encodingType = 'encoding-type';
      document.detectEntities(assert.ifError);
    });

    describe('error', function() {
      var apiResponse = {};
      var error = new Error('Error.');

      beforeEach(function() {
        document.api.Language = {
          analyzeEntities: function(reqOpts, callback) {
            callback(error, apiResponse);
          }
        };
      });

      it('should exec callback with error and API response', function(done) {
        document.detectEntities(function(err, entities, apiResponse_) {
          assert.strictEqual(err, error);
          assert.strictEqual(entities, null);
          assert.strictEqual(apiResponse_, apiResponse);
          done();
        });
      });
    });

    describe('success', function() {
      var apiResponse = {
        entities: []
      };

      var originalApiResponse = extend({}, apiResponse);

      beforeEach(function() {
        document.api.Language = {
          analyzeEntities: function(reqOpts, callback) {
            callback(null, apiResponse);
          }
        };
      });

      it('should format the entities', function(done) {
        var formattedEntities = {};

        Document.formatEntities_ = function(entities, verbose) {
          assert.strictEqual(entities, apiResponse.entities);
          assert.strictEqual(verbose, false);
          return formattedEntities;
        };

        document.detectEntities(function(err, entities) {
          assert.ifError(err);
          assert.strictEqual(entities, formattedEntities);
          done();
        });
      });

      it('should clone the response object', function(done) {
        document.detectEntities(function(err, entities, apiResponse_) {
          assert.ifError(err);
          assert.notStrictEqual(apiResponse_, apiResponse);
          assert.deepEqual(apiResponse_, originalApiResponse);
          done();
        });
      });

      it('should allow verbose mode', function(done) {
        Document.formatEntities_ = function(entities, verbose) {
          assert.strictEqual(verbose, true);
          done();
        };

        document.detectEntities({
          verbose: true
        }, assert.ifError);
      });
    });
  });

  describe('detectSentiment', function() {
    it('should make the correct API request', function(done) {
      document.api.Language = {
        analyzeSentiment: function(reqOpts) {
          assert.strictEqual(reqOpts.document, document.document);
          assert.strictEqual(reqOpts.encodingType, document.encodingType);
          done();
        }
      };

      document.encodingType = 'encoding-type';
      document.detectSentiment(assert.ifError);
    });

    describe('error', function() {
      var apiResponse = {};
      var error = new Error('Error.');

      beforeEach(function() {
        document.api.Language = {
          analyzeSentiment: function(reqOpts, callback) {
            callback(error, apiResponse);
          }
        };
      });

      it('should exec callback with error and API response', function(done) {
        document.detectSentiment(function(err, sentiment, apiResponse_) {
          assert.strictEqual(err, error);
          assert.strictEqual(sentiment, null);
          assert.strictEqual(apiResponse_, apiResponse);
          done();
        });
      });
    });

    describe('success', function() {
      var apiResponse = {
        documentSentiment: {}
      };

      var originalApiResponse = extend({}, apiResponse);

      beforeEach(function() {
        Document.formatSentiment_ = util.noop;

        document.api.Language = {
          analyzeSentiment: function(reqOpts, callback) {
            callback(null, apiResponse);
          }
        };
      });

      it('should format the sentiment', function(done) {
        var formattedSentiment = {};

        Document.formatSentiment_ = function(sentiment, verbose) {
          assert.strictEqual(sentiment, apiResponse.documentSentiment);
          assert.strictEqual(verbose, false);
          return formattedSentiment;
        };

        document.detectSentiment(function(err, sentiment) {
          assert.ifError(err);
          assert.strictEqual(sentiment, formattedSentiment);
          done();
        });
      });

      it('should clone the response object', function(done) {
        document.detectSentiment(function(err, sentiment, apiResponse_) {
          assert.ifError(err);
          assert.notStrictEqual(apiResponse_, apiResponse);
          assert.deepEqual(apiResponse_, originalApiResponse);
          done();
        });
      });

      it('should allow verbose mode', function(done) {
        Document.formatSentiment_ = function(sentiment, verbose) {
          assert.strictEqual(verbose, true);
          done();
        };

        document.detectSentiment({
          verbose: true
        }, assert.ifError);
      });
    });
  });

  describe('formatEntities_', function() {
    var ENTITIES = [
      { type: 'UNKNOWN', salience: -1, name: 'second' },
      { type: 'UNKNOWN', salience: 1, name: 'first' },

      { type: 'PERSON', salience: -1, name: 'second' },
      { type: 'PERSON', salience: 1, name: 'first'  },

      { type: 'LOCATION', salience: -1, name: 'second' },
      { type: 'LOCATION', salience: 1, name: 'first'  },

      { type: 'ORGANIZATION', salience: -1, name: 'second' },
      { type: 'ORGANIZATION', salience: 1, name: 'first'  },

      { type: 'EVENT', salience: -1, name: 'second' },
      { type: 'EVENT', salience: 1, name: 'first'  },

      { type: 'WORK_OF_ART', salience: -1, name: 'second' },
      { type: 'WORK_OF_ART', salience: 1, name: 'first'  },

      { type: 'CONSUMER_GOOD', salience: -1, name: 'second' },
      { type: 'CONSUMER_GOOD', salience: 1, name: 'first'  },

      { type: 'OTHER', salience: -1, name: 'second' },
      { type: 'OTHER', salience: 1, name: 'first'  }
    ];

    var VERBOSE = false;

    var entitiesCopy = extend(true, {}, ENTITIES);
    var FORMATTED_ENTITIES = {
      unknown: [ entitiesCopy[1], entitiesCopy[0] ],
      people: [ entitiesCopy[3], entitiesCopy[2] ],
      places: [ entitiesCopy[5], entitiesCopy[4] ],
      organizations: [ entitiesCopy[7], entitiesCopy[6] ],
      events: [ entitiesCopy[9], entitiesCopy[8] ],
      art: [ entitiesCopy[11], entitiesCopy[10] ],
      goods: [ entitiesCopy[13], entitiesCopy[12] ],
      other: [ entitiesCopy[15], entitiesCopy[14] ],
    };

    for (var entityType in FORMATTED_ENTITIES) {
      FORMATTED_ENTITIES[entityType] = FORMATTED_ENTITIES[entityType]
        .map(function(entity) {
          entity.salience *= 100;
          return entity;
        });
    }

    var EXPECTED_FORMATTED_ENTITIES = {
      default: extend(true, {}, FORMATTED_ENTITIES),
      verbose: extend(true, {}, FORMATTED_ENTITIES)
    };

    for (var entityGroupType in EXPECTED_FORMATTED_ENTITIES.default) {
      // Only the `name` property is returned by default:
      EXPECTED_FORMATTED_ENTITIES.default[entityGroupType] =
        EXPECTED_FORMATTED_ENTITIES.default[entityGroupType].map(prop('name'));
    }

    it('should group and sort entities correctly', function() {
      var formattedEntities = Document.formatEntities_(ENTITIES, VERBOSE);

      Document.sortByProperty_ = function(propertyName) {
        assert.strictEqual(propertyName, 'salience');
        return function() { return -1; };
      };

      assert.deepEqual(formattedEntities, EXPECTED_FORMATTED_ENTITIES.default);
    });

    it('should group and sort entities correctly in verbose mode', function() {
      var formattedEntities = Document.formatEntities_(ENTITIES, true);

      Document.sortByProperty_ = function(propertyName) {
        assert.strictEqual(propertyName, 'salience');
        return function() { return -1; };
      };

      assert.deepEqual(formattedEntities, EXPECTED_FORMATTED_ENTITIES.verbose);
    });
  });

  describe('formatSentences_', function() {
    var SENTENCES = [
      {
        text: {
          content: 'Sentence text',
          property: 'value'
        }
      },
      {
        text: {
          content: 'Another sentence',
          property: 'value'
        }
      }
    ];

    var VERBOSE = false;

    var EXPECTED_FORMATTED_SENTENCES = {
      default: SENTENCES.map(prop('text')).map(prop('content')),
      verbose: SENTENCES.map(prop('text'))
    };

    it('should correctly format sentences', function() {
      var formattedSentences = Document.formatSentences_(SENTENCES, VERBOSE);

      assert.deepEqual(
        formattedSentences,
        EXPECTED_FORMATTED_SENTENCES.default
      );
    });

    it('should correctly format sentences in verbose mode', function() {
      var formattedSentences = Document.formatSentences_(SENTENCES, true);

      assert.deepEqual(
        formattedSentences,
        EXPECTED_FORMATTED_SENTENCES.verbose
      );
    });
  });

  describe('formatSentiment_', function() {
    var SENTIMENT = {
      polarity: -0.5,
      magnitude: 0.5
    };

    var VERBOSE = false;

    var EXPECTED_FORMATTED_SENTIMENT = {
      default: SENTIMENT.polarity * 100,
      verbose: {
        polarity: SENTIMENT.polarity * 100,
        magnitude: SENTIMENT.magnitude * 100
      }
    };

    it('should format the sentiment correctly', function() {
      var sentiment = extend({}, SENTIMENT);
      var formattedSentiment = Document.formatSentiment_(sentiment, VERBOSE);

      assert.deepEqual(
        formattedSentiment,
        EXPECTED_FORMATTED_SENTIMENT.default
      );
    });

    it('should format the sentiment correctly in verbose mode', function() {
      var sentiment = extend({}, SENTIMENT);
      var formattedSentiment = Document.formatSentiment_(sentiment, true);

      assert.deepEqual(
        formattedSentiment,
        EXPECTED_FORMATTED_SENTIMENT.verbose
      );
    });
  });

  describe('formatTokens_', function() {
    var TOKENS = [
      {
        text: {
          content: 'Text content'
        },
        partOfSpeech: {
          tag: 'PART_OF_SPEECH_TAG'
        },
        property: 'value'
      }
    ];

    var VERBOSE = false;

    var PART_OF_SPEECH = {
      PART_OF_SPEECH_TAG: 'part of speech value'
    };

    var EXPECTED_FORMATTED_TOKENS = {
      default: TOKENS.map(function(token) {
        return {
          text: token.text.content,
          partOfSpeech: PART_OF_SPEECH.PART_OF_SPEECH_TAG,
          partOfSpeechTag: 'PART_OF_SPEECH_TAG'
        };
      }),

      verbose: TOKENS
    };

    beforeEach(function() {
      Document.PART_OF_SPEECH = PART_OF_SPEECH;
    });

    it('should correctly format tokens', function() {
      var formattedTokens = Document.formatTokens_(TOKENS, VERBOSE);

      assert.deepEqual(formattedTokens, EXPECTED_FORMATTED_TOKENS.default);
    });

    it('should correctly format tokens in verbose mode', function() {
      var formattedTokens = Document.formatTokens_(TOKENS, true);

      assert.deepEqual(formattedTokens, EXPECTED_FORMATTED_TOKENS.verbose);
    });
  });

  describe('sortByProperty_', function() {
    var sortFn;

    beforeEach(function() {
      sortFn = Document.sortByProperty_('sortedProperty');
    });

    it('should sort by a property name', function() {
      assert.strictEqual(
        sortFn({ sortedProperty: 0 }, { sortedProperty: 1 }),
        1
      );

      assert.strictEqual(
        sortFn({ sortedProperty: 1 }, { sortedProperty: -1 }),
        -1
      );

      assert.strictEqual(
        sortFn({ sortedProperty: 0 }, { sortedProperty: 0 }),
        0
      );
    });
  });
});
