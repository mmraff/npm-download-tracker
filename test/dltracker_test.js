const assert = require('assert')
const path = require('path')
const url = require('url')
const promisify = require('util').promisify

const expect = require('chai').expect
const fs = require('graceful-fs')
const copyFileAsync = promisify(fs.copyFile)
const mkdirAsync = promisify(fs.mkdir)
const readFileAsync = promisify(fs.readFile)
const unlinkAsync = promisify(fs.unlink)
const writeFileAsync = promisify(fs.writeFile)
const rimrafAsync = promisify(require('rimraf'))
const tar = require('tar')

const ut = require('./lib/utilities')
const mod = require('../')

const MAPFILE_NAME = 'dltracker.json'
const ASSETS_BASE = './test/assets'
const TEST_DIRS_BASE = './test/test_dirs'
const badJson = [
  { file: 'dltracker_GIT_NO-FILENAME.json', type: 'git', code: 'ENODATA' },
  { file: 'dltracker_GIT_REF-NO-COMMIT.json', type: 'git', code: 'ENODATA' },
  { file: 'dltracker_GIT_REF-ORPHAN.json', type: 'git', code: 'EORPHANREF' },
  { file: 'dltracker_SEMVER_NO-FILENAME.json', type: 'semver', code: 'ENODATA' },
  { file: 'dltracker_SEMVER-TAG_NO-VERSION.json', type: 'tag', code: 'ENODATA' },
  { file: 'dltracker_TAG_ORPHAN.json', type: 'tag', code: 'EORPHANREF' },
  { file: 'dltracker_URL_NO-FILENAME.json', type: 'url', code: 'ENODATA' }
]
const didNotRejectError = new Error('Failed to give expected rejection')

// Get a list of the values of all "filename" properties found in
// the JSON file at the given path
function extractFilenames(jsonFilepath) {
  return readFileAsync(jsonFilepath, 'utf8').then(s => {
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1)
    const list = []
    const map = JSON.parse(s) // can throw

    const semverMap = map.semver || {}
    for (let name in semverMap) {
      const versions = semverMap[name]
      for (let ver in versions) {
        if ('filename' in versions[ver])
          list.push(versions[ver].filename)
      }
    }
    const gitMap = map.git || {}
    for (let repo in gitMap) {
      const refs = gitMap[repo]
      for (let ref in refs) {
        if ('filename' in refs[ref])
          list.push(refs[ref].filename)
      }
    }
    const urlMap = map.url || {}
    for (let spec in urlMap) {
      if ('filename' in urlMap[spec])
        list.push(urlMap[spec].filename)
    }
    return list
  })
}

describe('DownloadTracker module', function() {
  const srcDir = path.join(TEST_DIRS_BASE, 'tarballs')
  const tempDir1 = path.join(TEST_DIRS_BASE, 'dir1')
  const tempDir2 = path.join(TEST_DIRS_BASE, 'dir2')
  const disposableDirs = [ srcDir, tempDir1, tempDir2 ]

  let currentTracker
  let noLoggingTracker

  before('make clean temporary directories', function(done) {
    function iterateDirs(i) {
      if (i >= disposableDirs.length) return Promise.resolve(null)
      return mkdirAsync(disposableDirs[i])
      .then(() => iterateDirs(i+1))
    }

    rimrafAsync(TEST_DIRS_BASE)
    .then(() => mkdirAsync(TEST_DIRS_BASE))
    .then(() => iterateDirs(0))
    .then(() => done())
    .catch(err => done(err))
  })
  after('remove temporary test assets', function(done) {
    rimrafAsync(TEST_DIRS_BASE).then(() => done())
    .catch(err => done(err))
  })

  it('should export a function: create', function() {
    expect(mod.create).to.be.a('function')
  })
  it('should export a non-empty object property: typeMap', function() {
    expect(mod.typeMap).to.be.an('object').that.is.not.empty
  })

  const emptyArgs   = [ undefined, null, '' ]
  const notStringArgs = [ 42, true, {}, [], function(){} ]
  const notSimpleObjects = [ 42, true, 'example', [], new Date(), function(){} ]
  const notFunctions = [ 42, true, 'example', {}, [] ]

  function dummyFunc(err, data) {
    throw new Error('This dummy function should never get called!')
  }

  describe('create() misuse', function() {
    it('should reject when given wrong type for path', function(done) {
      function iterateNonStrings(i) {
        if (i >= notStringArgs.length) return Promise.resolve(done())
        return mod.create(notStringArgs[i])
        .then(() => done(didNotRejectError))
        .catch(err => {
          expect(err).to.be.an.instanceOf(TypeError)
          return iterateNonStrings(i+1)
        })
      }

      iterateNonStrings(0).catch(err => done(err))
    })

    it('should reject for a non-existent path', function(done) {
      mod.create(path.join(ASSETS_BASE, 'NOT_THERE'))
      .then(() => done(didNotRejectError))
      .catch(err => {
        expect(err.code).to.equal('ENOENT')
        done()
      })
      .catch(err => done(err))
    })

    it('should reject for a path that is not a directory', function(done) {
      mod.create(path.join(ASSETS_BASE, 'json', 'dltracker_ALL_GOOD.json'))
      .then(() => done(didNotRejectError))
      .catch(err => {
        expect(err.code).to.equal('ENOTDIR')
        done()
      })
      .catch(err => done(err))
    })

    it('should reject when given wrong type for opts', function(done) {
      function iterateNonPOJOs(i) {
        if (i >= notSimpleObjects.length) return Promise.resolve(done())
        return mod.create('', notSimpleObjects[i])
        .then(() => done(didNotRejectError))
        .catch(err => {
          expect(err).to.be.an.instanceOf(TypeError)
          return iterateNonPOJOs(i+1)
        })
      }

      iterateNonPOJOs(0).catch(err => done(err))
    })
  })

  describe('create() correct use', function() {

    function runTrackerInspections() {
      it(
        'provided object should have these methods:' +
        ' add, audit, contains, getData, serialize',
        function() {
          expect(currentTracker.add).to.be.a('function')
          expect(currentTracker.audit).to.be.a('function')
          expect(currentTracker.contains).to.be.a('function')
          expect(currentTracker.getData).to.be.a('function')
          expect(currentTracker.serialize).to.be.a('function')
        }
      )

      it('and should have a non-empty string "path" property', function() {
        expect(currentTracker.path).to.be.a('string').that.is.not.empty
      })

      it('the "path" property should name an existing directory', function(done) {
        fs.stat(currentTracker.path, function(err, stats) {
          if (err) return done(err)
          if (!stats.isDirectory())
            return done(new Error("Given path is not a directory"))
          done()
        })
      })

      it('should be using the current directory when empty value given for path', function(done) {
        // cd to an empty directory before running this test; else we get lots
        // of log warnings (that I put there) for all the non-tarballs in the
        // main directory of the project!
        const startingDir = process.cwd()
        process.chdir(tempDir1)

        function iterateEmptyArgs(i) {
          if (i >= emptyArgs.length) return Promise.resolve(null)
          return mod.create(emptyArgs[i]).then(tracker => {
            expect(tracker.path).to.equal(process.cwd())
            return iterateEmptyArgs(i+1)
          })
        }
        function finish(err) {
          process.chdir(startingDir)
          currentTracker = noLoggingTracker
          done(err)
        }

        iterateEmptyArgs(0).then(() => finish())
        .catch(err => finish(err))
      })
    } // END runTrackerInspections.

    it('should provide a non-empty object', function(done) {
      mod.create(tempDir1).then(tracker => {
        expect(tracker).to.be.an('object').that.is.not.empty
        currentTracker = noLoggingTracker = tracker
        done()
      })
      .catch(err => done(err))
    })
    runTrackerInspections()

    it('should throw when given invalid values for log option', function(done) {
      const nopFunc = () => {}
      const notLogObjects = notSimpleObjects.concat([
        {},
        { error: nopFunc, warn: nopFunc, info: nopFunc }, // missing 'verbose'
        { error: "SURPRISE", warn: nopFunc, info: nopFunc, verbose: nopFunc }
      ])

      function iterateNonLogObjects(i) {
        if (i >= notLogObjects.length) return Promise.resolve(done())
        return mod.create(tempDir1, { log: notLogObjects[i] })
        .then(() => done(didNotRejectError))
        .catch(err => {
          expect(err).to.be.an.instanceOf(TypeError)
          return iterateNonLogObjects(i+1)
        })
      }

      iterateNonLogObjects(0).catch(err => done(err))
    })

    it('should have no errors when given undefined for log option', function(done) {
      mod.create(tempDir1, { log: undefined }).then(tracker => {
        expect(tracker).to.be.an('object').that.is.not.empty
        currentTracker = tracker
        done()
      })
      .catch(err => done(err))
    })
    runTrackerInspections()

    it('should have no errors when given null for log option', function(done) {
      mod.create(tempDir1, { log: null }).then(tracker => {
        expect(tracker).to.be.an('object').that.is.not.empty
        currentTracker = tracker
        done()
      })
      .catch(err => done(err))
    })
    runTrackerInspections()

    it('should have no errors when given false for log option', function(done) {
      mod.create(tempDir1, { log: false }).then(tracker => {
        expect(tracker).to.be.an('object').that.is.not.empty
        currentTracker = tracker
        done()
      })
      .catch(err => done(err))
    })
    runTrackerInspections()

    it('should have no errors when valid log object given for log option', function(done) {
      const nopFunc = () => {}
      const mockLog = {
        error: nopFunc, warn: nopFunc, info: nopFunc, verbose: nopFunc
      }
      mod.create(tempDir1, { log: mockLog }).then(tracker => {
        expect(tracker).to.be.an('object').that.is.not.empty
        currentTracker = tracker
        done()
      })
      .catch(err => done(err))
    })
    runTrackerInspections()
  })

  const goodData = {
    semver: {
      name: ut.dataKeys.semver.name,
      version: ut.dataKeys.semver.version,
      filename: ut.tarballNames.semver,
      extra: 'extra semver item data'
    },
    tag: {
      spec: ut.dataKeys.tag.spec,
      name: ut.dataKeys.tag.name,
      version: ut.dataKeys.tag.version,
      filename: ut.tarballNames.tag
    },
    git: {
      repo: ut.dataKeys.git.repo,
      commit: ut.dataKeys.git.commit,
      filename: ut.tarballNames.git,
      refs: [ 'master', 'v6.6.6' ],
      extra: 'extra git item data'
    },
    url: {
      spec: ut.dataKeys.url,
      filename: ut.tarballNames.url,
      extra: 'extra url item data'
    }
  }
  const unknownData = {
    semver: { name: 'not-dummy', spec: '3.4.5' },
    tag: { name: 'superbad', spec: 'teflon' },
    git: {
      name: 'bitbucket.com/another/project',
      spec: '9876543210fedcba9876543210fedcba98765432'
    },
    url: {
      name: null,
      spec: 'https://example.com/another/project/archive/abcdef.tgz'
    }
  }
  const filenames = Object.values(ut.tarballNames)

  const essentials = {}
  for (const type in ut.dataKeys) {
    const fields = new Set([ 'filename' ])
    switch (type) {
      case 'tag':
        fields.add('spec')
      case 'semver':
        fields.add('name')
        fields.add('version')
        break;
      case 'git':
        fields.add('repo')
        fields.add('commit')
        break;
      case 'url': 
        fields.add('spec')
        break;
    }
    essentials[type] = fields
  }

  // Return a copy of the given data stripped down to the bare minimums for the given type
  function onlyEssentials(type, data) {
    assert(type in essentials, `onlyEssentials: bad type '${type}'`)
    assert(data && typeof data === 'object', `onlyEssentials: bad data`)
    const result = { type: type }
    for (const prop in data) {
      if (essentials[type].has(prop))
        result[prop] = data[prop]
    }
    return result
  }

  function createOtherTarballs(startAt, fileList, srcPath) {
    function iterateFiles(i) {
      if (i >= fileList.length) return Promise.resolve(null)
      const copyPath = path.join(srcDir, fileList[i])
      return copyFileAsync(srcPath, copyPath)
      .then(() => iterateFiles(i+1))
    }
    return iterateFiles(startAt)
  }

  function mockAllDownloads(startAt, fileList, where) {
    function iterateDownloads(i) {
      if (i >= fileList.length) return Promise.resolve(null)
      const srcFilePath = path.join(srcDir, fileList[i])
      const tgtFilePath = path.join(where, fileList[i])
      return copyFileAsync(srcFilePath, tgtFilePath)
      .then(() => iterateDownloads(i+1))
    }
    return iterateDownloads(startAt)
  }

  function mockOneDownload(filename, where) {
    const tarballPath = path.join(srcDir, filenames[0])
    const copyPath = path.join(where, filename)
    return copyFileAsync(tarballPath, copyPath)
  }

  describe('Instance methods:', function() {
    before('create tarballs to mock packages to add', function(done) {
      const dummyContentPath = 'test/assets/package'
      const tarballPath = path.join(srcDir, filenames[0])

      tar.c(
        {gzip: true, file: tarballPath },
        [ dummyContentPath ]
      )
      .then(() => createOtherTarballs(1, filenames, tarballPath))
                        // the first (0) is the source we copy from
      .then(() => done())
      .catch(err => done(err))
    })

    describe('serialize()', function() {
      it('should resolve to false when no changes made yet', function(done) {
        currentTracker.serialize().then(written => {
          expect(written).to.be.false
          done()
        })
        .catch(err => done(err))
      })
    })

    describe('add()', function() {
      before('create a tracker instance for add() tests', function(done) {
        // We wait until the mod instance is created before we copy the
        // tarballs into the governed directory, so that the automatic iteration
        // of directory contents that happens in create() gets no results
        // (this time).
        mod.create(tempDir1).then(tracker => {
          currentTracker = tracker
          // Iteratively copy all the tarballs into the governed directory
          return mockAllDownloads(0, filenames, tempDir1)
        })
        .then(() => done())
        .catch(err => done(err))
      })

      it('should throw an error when not given enough arguments', function(done) {
        currentTracker.add().then(() => done(didNotRejectError))
        .catch(err => {
          expect(err).to.be.an.instanceOf(SyntaxError)
          return currentTracker.add('semver').then(() => done(didNotRejectError))
          .catch(err => {
            expect(err).to.be.an.instanceOf(SyntaxError)
            done()
          })
        })
        .catch(err => done(err))
      })

      it('should reject when passed an empty value for package type', function(done) {
        function iterateEmptyVals(i) {
          if (i >= emptyArgs.length) return Promise.resolve(done())
          return currentTracker.add(emptyArgs[i], goodData.semver)
          .then(() => done(didNotRejectError))
          .catch(err => {
            expect(err).to.be.an.instanceOf(SyntaxError)
            return iterateEmptyVals(i+1)
          })
        }

        iterateEmptyVals(0).catch(err => done(err))
      })

      it('should reject when passed wrong value type for package type', function(done) {
        function iterateNonStrings(i) {
          if (i >= notStringArgs.length) return Promise.resolve(done())
          return currentTracker.add(notStringArgs[i], goodData.semver)
          .then(() => done(didNotRejectError))
          .catch(err => {
            expect(err).to.be.an.instanceOf(TypeError)
            return iterateNonStrings(i+1)
          })
        }

        iterateNonStrings(0).catch(err => done(err))
      })

      it('should throw when passed an unhandled package type', function(done) {
        currentTracker.add('directory', goodData.semver)
        .then(() => done(didNotRejectError))
        .catch(err => {
          expect(err).to.be.an.instanceOf(RangeError)
          return currentTracker.add('nosuchtype', goodData.semver)
          .then(() => done(didNotRejectError))
          .catch(err => {
            expect(err).to.be.an.instanceOf(RangeError)
            done()
          })
        })
        .catch(err => done(err))
      })

      const goodTypes = Object.keys(goodData)

      it('should throw when passed empty data', function(done) {
        function iterateTypesWithEmptyData(i) {
          if (i >= goodTypes.length) return Promise.resolve(done())
          return currentTracker.add(goodTypes[i], {})
          .then(() => done(didNotRejectError))
          .catch(err => {
            expect(err).to.be.an.instanceOf(SyntaxError)
            return iterateTypesWithEmptyData(i+1)
          })
        }

        iterateTypesWithEmptyData(0).catch(err => done(err))
      })

      it('should throw when passed incomplete data', function(done) {
        function iterateTypesWithPartialData(i) {
          if (i >= goodTypes.length) return Promise.resolve(done())
          const type = goodTypes[i]
          const refData = goodData[type]
          const props = Object.keys(refData)
          return iteratePropsAsMissing(0)
          .then(allRejected => allRejected ?
            iterateTypesWithPartialData(i+1) :
            done(didNotRejectError)
          )

          function iteratePropsAsMissing(j) {
            if (j >= props.length) return Promise.resolve(true)
            const prop = props[j]
            // Props that are not required, so won't cause error when missing
            if (prop === 'extra' || prop === 'refs')
              return iteratePropsAsMissing(j+1)
            const modData = Object.assign({}, refData)
            delete modData[prop]
            return currentTracker.add(type, modData)
            .then(() => false)
            .catch(err => {
              expect(err).to.be.an.instanceOf(SyntaxError)
              return iteratePropsAsMissing(j+1)
            })
          }
        }

        iterateTypesWithPartialData(0).catch(err => done(err))
      })

      // Further recursive helper for the it('should') below
      function doGitRefsTests(data) {
        const notArrays = [ 42, true, 'example', {}, function(){} ]

        function iterateBadRefsValues(i) {
          if (i >= notArrays.length) return Promise.resolve(true)
          data.refs = notArrays[i]
          return currentTracker.add('git', data)
          .then(() => false)
          .catch(err => {
            expect(err).to.be.an.instanceOf(TypeError)
            return iterateBadRefsValues(i+1)
          })
        }
        function iterateBadRefsElements(i) {
          if (i >= notStringArgs.length) return Promise.resolve(true)
          data.refs = [ 'master', notStringArgs[i] ]
          return currentTracker.add('git', data)
          .then(() => false)
          .catch(err => {
            expect(err).to.be.an.instanceOf(TypeError)
            return iterateBadRefsElements(i+1)
          })
        }

        return iterateBadRefsValues(0)
        .then(allRejected => allRejected ? iterateBadRefsElements(0) : false)
        .then(allRejected => {
          if (!allRejected) return false
          data.refs = []
          return currentTracker.add('git', data)
          .then(() => false)
          .catch(err => {
            expect(err).to.be.an.instanceOf(SyntaxError)
            data.refs = [ 'master', '' ]
            return currentTracker.add('git', data)
            .then(() => false)
            .catch(err => {
              expect(err).to.be.an.instanceOf(SyntaxError)
              return true
            })
          })
        })
      }

      it('should reject when a required data field is the wrong type', function(done) {
        // YES, this too is a monster
        function iterateTypes(i) {
          if (i >= goodTypes.length) return Promise.resolve(done())
          const type = goodTypes[i]
          const refData = goodData[type]
          const props = Object.keys(refData)
          return iterateProps(0)
          .then(allRejected => allRejected ?
            iterateTypes(i+1) :
            done(didNotRejectError)
          )

          function iterateProps(j) {
            if (j >= props.length) return Promise.resolve(true)
            const prop = props[j]
            // Property 'extra' is not validated because it's not one of the required ones
            if (prop === 'extra')
              return iterateProps(j+1)
            const modData = Object.assign({}, refData)
            return (prop == 'refs' ?
              doGitRefsTests(modData) :
              iterateNonStringValues(0)
            ).then(allRejected => allRejected ? iterateProps(j+1) : false)

            function iterateNonStringValues(k) {
              if (k >= notStringArgs.length) return Promise.resolve(true)
              modData[prop] = notStringArgs[k]
              return currentTracker.add(type, modData)
              .then(() => false)
              .catch(err => {
                expect(err).to.be.an.instanceOf(TypeError)
                return iterateNonStringValues(k+1)
              })
            }
          }
        }

        iterateTypes(0).catch(err => done(err))
      })

      it('should have no error when used correctly', function(done) {
        function iterateTypes(i) {
          if (i >= goodTypes.length) return Promise.resolve(done())
          const type = goodTypes[i]
          return currentTracker.add(type, goodData[type])
          .then(() => iterateTypes(i+1))
        }

        iterateTypes(0).catch(err => done(err))
      })

      it('should leave existing semver entry undisturbed when tag data added for same entry', function(done) {
        const newTagData = Object.assign({}, goodData.semver)
        const name = newTagData.name
        const version = newTagData.version
        newTagData.spec = 'testTag'
        newTagData.extra = 'this must not get added'
        currentTracker.add('tag', newTagData).then(() => {
          const expectedData = Object.assign({ type: 'semver' }, goodData.semver)
          expect(currentTracker.getData('semver', name, version)).to.deep.equal(expectedData)
          newTagData.type = 'tag'
          expect(currentTracker.getData('tag', name, newTagData.spec)).to.not.deep.equal(newTagData)
          newTagData.extra = goodData.semver.extra
          expect(currentTracker.getData('tag', name, newTagData.spec)).to.deep.equal(newTagData)
          done()
        })
        .catch(err => done(err))
      })
    })

    const testName = goodData.semver.name
    const testVer = goodData.semver.version

    // The throwable test conditions are exactly the same for getData and contains
    function runThrowableTestsOnQuery(methodName) {
      assert(
        methodName === 'getData' || methodName === 'contains',
        `Bad method name '${methodName}' passed to runThrowableTestsOnQuery!`
      )
      it('should throw an error when not given enough arguments', function() {
        expect(function() {
          currentTracker[methodName]()
        }).to.throw(SyntaxError)

        expect(function() {
          currentTracker[methodName]('semver')
        }).to.throw(SyntaxError)

        expect(function() {
          currentTracker[methodName]('semver', 'dummy')
        }).to.throw(SyntaxError)
      })

      it('should throw when passed an empty value for package type', function() {
        for (var i = 0; i < emptyArgs.length; ++i) {
          expect(function() {
            currentTracker[methodName](emptyArgs[i], testName, testVer)
          }).to.throw(SyntaxError)
        }
      })

      it('should throw when passed wrong value type for package type', function() {
        for (var i = 0; i < notStringArgs.length; ++i) {
          expect(function() {
            currentTracker[methodName](notStringArgs[i], testName, testVer)
          }).to.throw(TypeError)
        }
      })

      it('should throw when passed an unhandled package type', function() {
        expect(function() {
          // A valid npm type, but not download-able
          currentTracker[methodName]('directory', testName, testVer)
        }).to.throw(RangeError)
        expect(function() {
          currentTracker[methodName]('nosuchtype', testName, testVer)
        }).to.throw(RangeError)
      })

      it('should throw when passed empty value for package name when type is semver or tag',
        function() {
          var i
          for (i = 0; i < emptyArgs.length; ++i) {
            expect(function() {
              currentTracker[methodName]('semver', emptyArgs[i], testVer)
            }).to.throw(SyntaxError)
          }
          for (i = 0; i < emptyArgs.length; ++i) {
            expect(function() {
              currentTracker[methodName]('tag', emptyArgs[i], testVer)
            }).to.throw(SyntaxError)
          }
        }
      )

      it('should throw when passed wrong value type for package name', function() {
        for (var type in goodData) {
          for (var i = 0; i < notStringArgs.length; ++i) {
            expect(function() {
              currentTracker[methodName](type, notStringArgs[i], testVer)
            }).to.throw(type === 'url' ? SyntaxError : TypeError)
          }
        }
      })
    }

    function runCommon_getData_tests(haveJSON) {
      it ('should return undefined for package name & spec that has not been added',
        function() {
          for (var type in unknownData) {
            let item = unknownData[type]
            let other = goodData[type]
            assert(
              item.name != (other.name || other.repo) ||
              item.spec != (other.spec || other.version || other.commit),
              'Test data for unknown entry is not supposed to match known entry! FIX ME!'
            )
            expect(currentTracker.getData(type, item.name, item.spec)).to.be.undefined
          }
        }
      )

      it('should return same data passed to previous call to add(), plus type', function() {
        for (var type in goodData) {
          // !haveJSON is the recovery case:
          // A semver tarball filename never has any tag information in it,
          // so it's useless to test for our tag data
          if (type === 'tag' && !haveJSON) continue;
          const currData = haveJSON ? Object.assign({ type: type }, goodData[type])
                                    : onlyEssentials(type, goodData[type])
          let name = currData.name // maybe undefined
          let spec
          switch (type) {
            case 'semver':
              spec = currData.version;
              break
            case 'git':
              name = currData.repo;
              spec = currData.commit;
              break;
            case 'tag':
            case 'url':
              spec = currData.spec;
              break
          }
          expect(currentTracker.getData(type, name, spec)).to.deep.equal(currData)
        }
      })

      it('should return data of the highest-numbered version passed to add() so far when tag spec "" is given',
        function() {
          const resultData = currentTracker.getData('tag', testName, '')
          const refData = haveJSON ?
            Object.assign({ type: 'semver' }, goodData.semver) :
            onlyEssentials('semver', goodData.semver)
          const refTagData = haveJSON ?
            Object.assign({ type: 'semver' }, goodData.tag) :
            onlyEssentials('tag', goodData.tag)
          expect(resultData).to.deep.equal(refData)
          expect(resultData).to.not.deep.equal(refTagData)
        }
      )

      it('should return data of highest-numbered version passed to add() so far when tag spec "latest" is given',
        function() {
          const resultData = currentTracker.getData('tag', testName, 'latest')
          const refData = haveJSON ?
            Object.assign({ type: 'semver' }, goodData.semver) :
            onlyEssentials('semver', goodData.semver)
          const refTagData = haveJSON ?
            Object.assign({ type: 'semver' }, goodData.tag) :
            onlyEssentials('tag', goodData.tag)
          expect(resultData).to.deep.equal(refData)
          expect(resultData).to.not.deep.equal(refTagData)
        }
      )

      it('should return data of an added version that is contained in the range given as spec',
        function() {
          const ranges = ut.dataKeys.semver.ranges
          const refData = haveJSON ?
            Object.assign({ type: 'semver' }, goodData.semver) :
            onlyEssentials('semver', goodData.semver)
          for (let i = 0; i < ranges.length; ++i) {
            expect(currentTracker.getData('semver', testName, ranges[i]))
              .to.deep.equal(refData)
          }
        }
      )

      it('should not return data of an added version that is not contained in the range given as spec',
        function() {
          const notRanges = ut.dataKeys.semver.notRanges
          const refData = Object.assign({ type: 'semver' }, goodData.semver)
          for (let i = 0; i < notRanges.length; ++i) {
            expect(currentTracker.getData('semver', testName, notRanges[i]))
              .to.not.deep.equal(refData)
          }
        }
      )

      if (haveJSON) {
        const gitRepo = goodData.git.repo
        const refData = Object.assign({ type: 'git' }, goodData.git)
        it('should return data of the queried git repo if no spec given, when record contains ref "master" or "main"',
          function() {
            const resultData = currentTracker.getData('git', gitRepo, '')
            expect(resultData).to.deep.equal(refData)
          }
        )
        it('should return data of a git repo queried by spec "*", when record contains ref "master" or "main"',
          function() {
            const resultData = currentTracker.getData('git', gitRepo, '*')
            expect(resultData).to.deep.equal(refData)
          }
        )
        it('should return data matching previously added record when queried by correct git tag',
          function() {
            const refs = goodData.git.refs
            for (let i = 0; i < refs.length; ++i) {
              const resultData = currentTracker.getData('git', gitRepo, refs[i])
              const extendedRefData = Object.assign({ spec: refs[i] }, refData)
              expect(resultData).to.deep.equal(extendedRefData)
            }
          }
        )
        it('should return undefined when queried for known repo, but with git tag not matching any record',
          function() {
            expect(currentTracker.getData('git', gitRepo, 'UNKNOWN_REF')).to.be.undefined
          }
        )

        // For when tracker is queried for a git package by semver expression (obscure case!)
        it('should return correct data when queried by range spec matching previously added version (git pkg)',
          function() {
            // For visual verification: currently, goodData.git.refs[1] is 'v6.6.6'
            // OK, 1st verify that programmatically:
            assert(goodData.git.refs[1] == 'v6.6.6', 'OH NO, the git test data was changed...')
            const rangeSpec = 'semver:^6.3'
            const resultData = currentTracker.getData('git', gitRepo, rangeSpec)
            const extendedRefData = Object.assign({ spec: rangeSpec }, refData)
            expect(resultData).to.deep.equal(extendedRefData)
          }
        )
        it('should return undefined when queried by range spec not matching previously added version (git pkg)',
          function() {
            const omittingRange = 'semver:<1.2.3'
            const resultData = currentTracker.getData('git', gitRepo, omittingRange)
            if (resultData) {
              console.error(`OOPS: ${gitRepo} ${omittingRange}`)
              console.dir(resultData)
            }
            expect(resultData).to.be.undefined
          }
        )

        // More edge cases - these require adding more git records

        it('should return correct data when queried by git repo without spec when only 1 record exists for that',
          function(done) {
            const refData = {
              repo: 'dark.net/darko/dark-project',
              commit: 'abcdef0123456789abcdef0123456789abcdef01',
              filename: 'dark.net%2Fdarko%2Fdark-project%23abcdef0123456789abcdef0123456789abcdef01.tar.gz',
              extra: 'this was a late addition'
              // Note there are no refs here.
            }
            mockOneDownload(refData.filename, currentTracker.path)
            .then(() => currentTracker.add('git', refData))
            .then(() => {
              const extendedRefData = Object.assign({type:'git'}, refData)
              const resultData = currentTracker.getData('git', refData.repo, '')
              expect(resultData).to.deep.equal(extendedRefData)
              done()
            })
            .catch(err => done(err))
          }
        )
      }
    }

    function runCommon_contains_tests(haveJSON) {
      it ('should return false for package name & spec that has not been added',
        function() {
          for (var type in unknownData) {
            let item = unknownData[type]
            let other = goodData[type]
            assert(
              item.name != (other.name || other.repo) ||
              item.spec != (other.spec || other.version || other.commit),
              'Test data for unknown entry is not supposed to match known entry! FIX ME!'
            )
            expect(currentTracker.contains(type, item.name, item.spec)).to.be.false
          }
        }
      )

      it ('should return true for a specific package name/spec that has been added',
        function() {
          for (var type in goodData) {
            // !haveJSON is the recovery case:
            // A semver tarball filename never has any tag information in it,
            // so it's useless to test for our tag data
            if (type === 'tag' && !haveJSON) continue
            const currData = goodData[type]
            let name = currData.name // maybe undefined
            let spec
            switch (type) {
              case 'semver':
                spec = currData.version;
                break
              case 'tag':
              case 'url':
                spec = currData.spec;
                break
              case 'git':
                name = currData.repo;
                spec = currData.commit;
                break;
            }
            expect(currentTracker.contains(type, name, spec)).to.be.true
          }
        }
      )

      it ('should return true when queried with spec "" where the named semver package has been added',
        function() {
          expect(currentTracker.contains('tag', testName, '')).to.be.true
        }
      )

      it ('should return true when queried with spec "latest" where the named semver package has been added',
        function() {
          expect(currentTracker.contains('tag', testName, 'latest')).to.be.true
        }
      )

      it('should return true when queried by range spec matching previously added version (semver pkg)',
        function() {
          const ranges = ut.dataKeys.semver.ranges
          for (let i = 0; i < ranges.length; ++i) {
            expect(currentTracker.contains('semver', testName, ranges[i])).to.be.true
          }
        }
      )

      it('should return false when queried by range spec that does not match any previously added version',
        function() {
          const notRanges = ut.dataKeys.semver.notRanges
          for (let i = 0; i < notRanges.length; ++i) {
            const result = currentTracker.contains('semver', testName, notRanges[i])
            if (result) {
              console.error(`OOPS: ${testName} ${notRanges[i]}`)
              console.dir(currentTracker.getData('semver', testName, notRanges[i]))
            }
            expect(result).to.be.false
          }
        }
      )

      if (haveJSON) {
        const gitRepo = goodData.git.repo
        it('should return true when queried by git repo if no spec given, when record contains ref "master" or "main"',
          function() {
            const refs = goodData.git.refs
            expect(currentTracker.contains('git', gitRepo, '')).to.be.true
          }
        )
        it('should return true when queried by git tag matching previously added record',
          function() {
            const refs = goodData.git.refs
            for (let i = 0; i < refs.length; ++i)
              expect(currentTracker.contains('git', gitRepo, refs[i])).to.be.true
          }
        )
        it('should return false when queried by git tag not matching any previously added record',
          function() {
            expect(currentTracker.contains('git', gitRepo, 'UNKNOWN_REF')).to.be.false
          }
        )

        // For when tracker is queried for a git package by semver expression (obscure case!)
        it('should return true when queried by range spec matching previously added version (git pkg)',
          function() {
            // For visual verification: currently, goodData.git.refs[1] is 'v6.6.6'
            // OK, 1st verify that programmatically:
            assert(goodData.git.refs[1] == 'v6.6.6', 'OH NO, the git test data was changed...')
            expect(currentTracker.contains('git', gitRepo, 'semver:^6.3')).to.be.true
          }
        )
        it('should return false when queried by range spec not matching previously added version (git pkg)',
          function() {
            const omittingRange = 'semver:<1.2.3'
            const result = currentTracker.contains('git', gitRepo, omittingRange)
            if (result) {
              console.error(`OOPS: ${gitRepo} ${omittingRange}`)
              console.dir(currentTracker.getData('git', gitRepo, omittingRange))
            }
            expect(result).to.be.false
          }
        )
      }
    }

    describe('getData()', function() {
      runThrowableTestsOnQuery('getData')
      runCommon_getData_tests(true)
    })

    describe('contains()', function() {
      runThrowableTestsOnQuery('contains')
      runCommon_contains_tests(true)
    })

    describe('serialize()', function() {
      it('should create a dltracker.json file with no error when used after changes', function(done) {
        currentTracker.serialize().then(written => {
          expect(written).to.be.true
          fs.stat(path.join(tempDir1, 'dltracker.json'), function(err, stats) {
            if (!err && !stats.isFile())
              err = new Error('dltracker.json is not a regular file')
            // Size: never mind the description field; we've already added
            // well over 50 bytes of data...
            if (!err && stats.size < 50)
              err = new Error('dltracker.json is truncated')
            done(err)
          })
        })
      })
      
    })

    describe('For a new instance with tarballs and a JSON file,', function() {
      before('create a tracker instance for data recovery tests', function(done) {
        mod.create(tempDir1).then(tracker => {
          currentTracker = tracker
          done()
        })
        .catch(err => done(err))
      })

      describe('getData()', function() {
        runCommon_getData_tests(true)
      })
      describe('contains()', function() {
        runCommon_contains_tests(true)
      })

      describe('audit()', function() {
        it('should have no error and no results when all tarballs are accounted for', function(done) {
          currentTracker.audit().then(data => {
            expect(data).to.be.an('array').that.has.length(0)
            done()
          })
          .catch(err => done(err))
        })

        let affected = 0

        function zeroFileAndTestAudit(filePath) {
          return writeFileAsync(filePath, '')
          .then(() => {
            ++affected
            return currentTracker.audit()
          })
          .then(data => {
            expect(data).to.be.an('array').that.has.length(affected)
            let latestProblem = null
            for (let i = 0; i < data.length; ++i) {
              expect(data[i]).to.have.property('data').that.is.an('object')
              expect(data[i]).to.have.property('error').that.is.an('error')
              if (data[i].error.path == filePath)
                latestProblem = data[i]
            }
            expect(latestProblem).to.not.be.null
            expect(latestProblem.error.path).to.equal(filePath)
            expect(latestProblem.error.code).to.equal('EFZEROLEN')
            return rmAndTestAudit(filePath)
          })
        }

        function rmAndTestAudit(filePath) {
          return unlinkAsync(filePath)
          .then(() => currentTracker.audit())
          .then(data => {
            expect(data).to.be.an('array').that.has.length(affected)
            for (let i = 0; i < data.length; ++i) {
              expect(data[i]).to.have.property('data').that.is.an('object')
              expect(data[i]).to.have.property('error').that.is.an('error')
              expect(data[i].error.code).to.equal('ENOENT')
            }
          })
        }

        it('should pass back an array of items when problems are detected', function(done) {
          const keys = Object.keys(ut.tarballNames)

          function iterateAndDestroyFiles(i) {
            if (i >= keys.length) return Promise.resolve(done())
            const currName = ut.tarballNames[keys[i]]
            const filePath = path.resolve(tempDir1, currName)
            return zeroFileAndTestAudit(filePath)
            .then(() => iterateAndDestroyFiles(i+1))
          }

          iterateAndDestroyFiles(0).catch(err => done(err))
        })

        // Late addition: Tests of problems in the JSON
        it('should contain error and data for each problem in the JSON', function(done) {
          const origFilePath = path.join(srcDir, filenames[0])
          const allGoodJsonPath = path.join(ASSETS_BASE, 'json', 'dltracker_ALL_GOOD.json')
          extractFilenames(allGoodJsonPath)
          .then(moreTarballs => {
            return createOtherTarballs(0, moreTarballs, origFilePath)
            .then(() => mockAllDownloads(0, moreTarballs, tempDir2))
            .then(() => iterateBadJsonFiles(0))
          })
          .then(() => done())
          .catch(err => done(err))

          function iterateBadJsonFiles(i) {
            if (i >= badJson.length) return Promise.resolve(null)
            const src = path.join(ASSETS_BASE, 'json', badJson[i].file)
            const tgt = path.join(tempDir2, MAPFILE_NAME)
            return copyFileAsync(src, tgt)
            .then(() => mod.create(tempDir2))
            .then(tracker => tracker.audit())
            .then(results => {
              expect(results).to.be.an('array').that.is.not.empty
              expect(results[0].data.type).to.equal(badJson[i].type)
              expect(results[0].error.code).to.equal(badJson[i].code)
              return iterateBadJsonFiles(i+1)
            })
          }
        })
      })

    })

    describe('For a new instance with tarballs but no JSON file,', function() {
      before('create a tracker instance for data recovery tests', function(done) {
        rimrafAsync(tempDir2)
        .then(() => mkdirAsync(tempDir2))
        .then(() => mockAllDownloads(0, filenames, tempDir2))
        .then(() => mod.create(tempDir2)).then(tracker => {
          currentTracker = tracker
          done()
        })
        .catch(err => done(err))
      })

      describe('getData()', function() {
        runCommon_getData_tests()
      })
      describe('contains()', function() {
        runCommon_contains_tests()
      })
    })

  })

})

