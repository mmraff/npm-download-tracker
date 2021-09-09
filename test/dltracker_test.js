const assert = require('assert')
const fs = require('fs')
const path = require('path')
const url = require('url')

const expect = require('chai').expect
const mkdirp = require('mkdirp')
const rimraf = require('rimraf')
const tar = require('tar')

const maker = require('../')

function makeCleanDir(dirPath, next, finish) {
  rimraf(dirPath, function(rmrfErr) {
    if (rmrfErr) return finish(rmrfErr)
    mkdirp(dirPath, function(mkdirpErr) {
      if (mkdirpErr) return finish(mkdirpErr)
      next()
    })
  })
}

function copyFile(from, to, cb) {
  var hadError = false
  function errorOut(err) {
    hadError = true
    cb(err)
  }
  fs.createReadStream(from)
  .once('error', errorOut)
  .pipe(fs.createWriteStream(to, {encoding: null}))
  .once('error', errorOut)
  .once('close', function () {
    if (hadError) return
    cb()
  })
}

describe('DownloadTracker module', function() {
  const srcDir = 'test/assets/tarballs'
  const tempDir1 = 'test/assets/dir1'
  const tempDir2 = 'test/assets/dir2'

  let currentTracker

  before('make clean temporary directories', function(done) {
    makeCleanDir(
      srcDir,
      function() {
        makeCleanDir(
          tempDir1,
          function() { makeCleanDir(tempDir2, done, done) },
          done
        )
      },
      done
    )
  })

  it('should export a function: create', function() {
    expect(maker.create).to.be.a('function')
  })
  it('should export an object property: typeMap', function() {
    expect(maker.typeMap).to.be.an('object')
  })
  it('the typeMap object should be non-empty', function() {
    expect(maker.typeMap).to.not.be.empty
  })

  var emptyArgs   = [ undefined, null, '' ]
    , notStringArgs = [ 42, true, {}, [] ]
    , notSimpleObjects = [ 42, true, 'example', [], new Date() ]
    , notFunctions = [ 42, true, 'example', {}, [] ]

  function dummyFunc(err, data) {
    assert(false, 'This dummy function should never get called!')
  }

  describe('create() misuse', function() {
    it('should throw an error when given no arguments', function() {
      expect(function() { maker.create() }).to.throw(SyntaxError)
    })

    it('should throw an error when given no callback', function() {
      expect(function() { maker.create('') }).to.throw(SyntaxError)
    })

    it('should throw an error when given wrong type for callback', function() {
      for (let i = 0; i < notFunctions.length; ++i) {
        expect(function() {
          maker.create('', notFunctions[i])
        }).to.throw(TypeError)
      }
    })

    it('should throw an error when only given a callback', function() {
      expect(function() { maker.create(dummyFunc) }).to.throw(TypeError)
    })

    it('should throw when given wrong type for path', function() {
      for (i = 0; i < notStringArgs.length; ++i) {
        expect(function() {
          maker.create(notStringArgs[i], dummyFunc)
        }).to.throw(TypeError)
      }
    })

    it('should pass back an error for non-existent path', function(done) {
      maker.create('test/assets/NOT_THERE', function(err, tracker) {
        expect(tracker).to.be.undefined
        expect(err).to.be.an('error')
        done()
      })
    })

    it('should throw when given wrong type for opts', function(done) {
      for (i = 0; i < notSimpleObjects.length; ++i) {
        expect(function() {
          maker.create('', notSimpleObjects[i], dummyFunc)
        }).to.throw(TypeError)
      }
      done()
    })
  })

  describe('create() correct use', function() {

    it('should provide a non-empty object', function(done) {
      maker.create(tempDir1, function(err, tracker) {
        if (err) return done(err)
        expect(tracker).to.be.an('object').that.is.not.empty
        currentTracker = tracker
        done()
      })
    })

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

    it('should be using the current directory when empty value given for path',
      function(done) {
        // cd to an empty directory before running this test; else we get lots
        // of log warnings (that I put there) for all the non-tarballs in the
        // main directory of the project!
        const startingDir = process.cwd()
        process.chdir(tempDir1)
        let i = 0
        function next() {
          if (i == emptyArgs.length) {
            process.chdir(startingDir)
            return done()
          }
          maker.create(emptyArgs[i], function(err, tracker) {
            if (err) return done(err)
            expect(tracker.path).to.equal(process.cwd())
            ++i
            next()
          })
        }
        next()
      }
    )
  })

  const dataKeys = {
    semver: {
      name: 'dummy', version: '1.2.3',
      ranges: ['~1', '^1.2', '<2.0'],
      notRanges: ['~1.1', '<0.1 || >=1.5', '^2']
    },
    tag: { name: 'dummy', version: '0.1.2', spec: 'next.big.thing' },
    git: {
      repo: 'github.com/someUser/example',
      commit: '0123456789abcdef0123456789abcdef01234567',
      tags: ['v2.3.4', 'main']
    },
    url: 'https://example.com/someuser/example/archive/5559999.tgz'
  }
  const parsedUrl = url.parse(dataKeys.url)
  const tarballNames = {
    semver: `${dataKeys.semver.name}-${dataKeys.semver.version}.tar.gz`,
    tag: `${dataKeys.tag.name}-${dataKeys.tag.version}.tar.gz`,
    git: encodeURIComponent(`${dataKeys.git.repo}#${dataKeys.git.commit}`) + '.tar.gz',
    url: encodeURIComponent(`${parsedUrl.host}${parsedUrl.path}`)
  }
  const goodData = {
    semver: {
      name: dataKeys.semver.name,
      version: dataKeys.semver.version,
      filename: tarballNames.semver,
      extra: 'extra semver item data'
    },
    tag: {
      spec: dataKeys.tag.spec,
      name: dataKeys.tag.name,
      version: dataKeys.tag.version,
      filename: tarballNames.tag
    },
    git: {
      repo: dataKeys.git.repo,
      commit: dataKeys.git.commit,
      filename: tarballNames.git,
      extra: 'extra git item data'
    },
    url: {
      spec: dataKeys.url,
      filename: tarballNames.url,
      extra: 'extra url item data'
    }
  }
  const unkownData = {
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
  const filenames = Object.values(tarballNames)
  const essentials = {}
  for (const type in goodData) {
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

  function mockAllDownloads(idx, where, done) {
    copyFile(
      path.join(srcDir, filenames[idx]), path.join(where, filenames[idx]),
      function(err) {
        if (err) return done(err)
        if (++idx < filenames.length)
          return mockAllDownloads(idx, where, done)
        done()
      }
    )
  }

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

  describe('Instance methods:', function() {
    before('create tarballs to mock packages to add', function(done) {
      const dummyContentPath = 'test/assets/package'
      const tarballPath = path.join(srcDir, filenames[0])

      function createOtherTarballs(idx) {
        copyFile(
          tarballPath, path.join(srcDir, filenames[idx]),
          function(err) {
            if (err) return done(err)
            if (++idx < filenames.length)
              return createOtherTarballs(idx)
            done()
          }
        )
      }

      tar.c(
        { gzip: true, file: tarballPath }, [ dummyContentPath ]
      ).then(() => {
        createOtherTarballs(1) // the first (0) is what we copy from
      }).catch(err => {
        done(err)
      })
    })

    describe('serialize()', function() {
      it('should pass back false when no changes made yet', function(done) {
        currentTracker.serialize(function(err) {
          expect(err).to.be.false
          done()
        })
      })
    })

    describe('add()', function() {
      before('create a tracker instance for add() tests', function(done) {
        // We wait until the maker instance is created before we copy the
        // tarballs into the governed directory, so that the automatic iteration
        // of directory contents that happens in create() gets no results
        // (this time).
        maker.create(tempDir1, function(err, tracker) {
          if (err) return done(err)
          currentTracker = tracker
          // Iteratively copy all the tarballs into the governed directory
          mockAllDownloads(0, tempDir1, done)
        })
      })

      it('should throw an error when not given enough arguments', function(done) {
        expect(function() {
          currentTracker.add()
        }).to.throw(SyntaxError)

        expect(function() {
          currentTracker.add('semver')
        }).to.throw(SyntaxError)

        expect(function() {
          currentTracker.add('semver', goodData.semver)
        }).to.throw(SyntaxError)

        done()
      })

      it('should throw an error when given wrong type for callback', function() {
        for (let i = 0; i < notFunctions.length; ++i) {
          expect(function() {
            currentTracker.add('semver', goodData.semver, notFunctions[i])
          }).to.throw(TypeError)
        }
      })

      it('should throw when passed an empty value for package type', function(done) {
        for (var i = 0; i < emptyArgs.length; ++i) {
          expect(function() {
            currentTracker.add(emptyArgs[i], goodData.semver, dummyFunc)
          }).to.throw(SyntaxError)
        }
        done()

      })

      it('should throw when passed wrong value type for package type', function(done) {
        for (var i = 0; i < notStringArgs.length; ++i) {
          expect(function() {
            currentTracker.add(notStringArgs[i], goodData.semver, dummyFunc)
          }).to.throw(TypeError)
        }
        done()
      })

      it('should throw when passed an unhandled package type', function(done) {
        expect(function() {
          // A valid npm type, but not download-able
          currentTracker.add('directory', goodData.semver, dummyFunc)
        }).to.throw(RangeError)
        expect(function() {
          currentTracker.add('nosuchtype', goodData.semver, dummyFunc)
        }).to.throw(RangeError)
        done()
      })

      it('should throw when passed empty data', function(done) {
        for (var type in goodData)
          expect(function() {
            currentTracker.add(type, {}, dummyFunc)
          }).to.throw(SyntaxError)

        done()
      })

      it('should throw when passed incomplete data', function(done) {
        for (var type in goodData) {
          const d0 = goodData[type]
          for (var prop in d0) {
            if (prop === 'extra') continue
            const dx = Object.assign({}, d0)
            delete dx[prop]
            expect(function() {
              currentTracker.add(type, dx, dummyFunc)
            }).to.throw(SyntaxError)
          }
        }

        done()
      })

      it('should throw when a required data field is the wrong type', function(done) {
        for (var type in goodData) {
          const d0 = goodData[type]
          for (var prop in d0) {
            if (prop === 'extra') continue
            const dx = Object.assign({}, d0)
            for (var i = 0; i < notStringArgs.length; ++i) {
              dx[prop] = notStringArgs[i]
              expect(function() {
                currentTracker.add(type, dx, dummyFunc)
              }).to.throw(TypeError)
            }
          }
        }

        done()
      })

      it('should have no error when used correctly', function(done) {
        const typeList = Object.keys(goodData)
        let i = 0
        function next() {
          const type = typeList[i]
          currentTracker.add(type, goodData[type], function(err) {
            if (err) {
              console.error('add() error on type:', type, 'data:', goodData[type])
              return done(err)
            }
            if (++i < typeList.length) return next()
            done()
          })
        }
        next()
      })

      it('should leave existing semver entry undisturbed when tag data is added for that same entry',
        function(done) {
          const newTagData = Object.assign({}, goodData.semver)
          const name = newTagData.name
          const version = newTagData.version
          newTagData.spec = 'testTag'
          newTagData.extra = 'this must not get added'
          currentTracker.add('tag', newTagData, function(err) {
            if (err) {
              console.error('add() error on type:', type, 'data:', newTagData)
              return done(err)
            }
            const expectedData = Object.assign({ type: 'semver' }, goodData.semver)
            expect(currentTracker.getData('semver', name, version)).to.deep.equal(expectedData)
            newTagData.type = 'tag'
            expect(currentTracker.getData('tag', name, newTagData.spec)).to.not.deep.equal(newTagData)
            newTagData.extra = goodData.semver.extra
            expect(currentTracker.getData('tag', name, newTagData.spec)).to.deep.equal(newTagData)
            done()
          })
        }
      )
    })

    const testName = goodData.semver.name
    const testVer = goodData.semver.version
    // The throwable tests are exactly the same for getData and contains
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
          for (var type in unkownData) {
            let item = unkownData[type]
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
          const refData = haveJSON ? Object.assign({ type: 'semver' }, goodData.semver)
                                   : onlyEssentials('semver', goodData.semver)
          const refTagData = haveJSON ? Object.assign({ type: 'semver' }, goodData.tag)
                                      : onlyEssentials('tag', goodData.tag)
          expect(resultData).to.deep.equal(refData)
          expect(resultData).to.not.deep.equal(refTagData)
        }
      )

      it('should return data of the highest-numbered version passed to add() so far when tag spec "latest" is given',
        function() {
          const resultData = currentTracker.getData('tag', testName, 'latest')
          const refData = haveJSON ? Object.assign({ type: 'semver' }, goodData.semver)
                                   : onlyEssentials('semver', goodData.semver)
          const refTagData = haveJSON ? Object.assign({ type: 'semver' }, goodData.tag)
                                      : onlyEssentials('tag', goodData.tag)
          expect(resultData).to.deep.equal(refData)
          expect(resultData).to.not.deep.equal(refTagData)
        }
      )

      it('should return data of an added version that is contained in the range given as spec',
        function() {
          const ranges = dataKeys.semver.ranges
          const refData = haveJSON ? Object.assign({ type: 'semver' }, goodData.semver)
                                   : onlyEssentials('semver', goodData.semver)
          for (let i = 0; i < ranges.length; ++i) {
            expect(currentTracker.getData('semver', testName, ranges[i]))
              .to.deep.equal(refData)
          }
        }
      )

      it('should not return data of an added version that is not contained in the range given as spec',
        function() {
          const notRanges = dataKeys.semver.notRanges
          const refData = Object.assign({ type: 'semver' }, goodData.semver)
          for (let i = 0; i < notRanges.length; ++i) {
            expect(currentTracker.getData('semver', testName, notRanges[i]))
              .to.not.deep.equal(refData)
          }
        }
      )
    }

    function runCommon_contains_tests(haveJSON) {
      it ('should return false for package name & spec that has not been added',
        function() {
          for (var type in unkownData) {
            let item = unkownData[type]
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

      it('should return true when queried by range spec that matches a previously added version',
        function() {
          const ranges = dataKeys.semver.ranges
          for (let i = 0; i < ranges.length; ++i) {
            expect(currentTracker.contains('semver', testName, ranges[i])).to.be.true
          }
        }
      )

      it('should return false when queried by range spec that does not match any previously added version',
        function() {
          const notRanges = dataKeys.semver.notRanges
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
      it('should throw an error when not given an argument', function() {
        expect(function() { currentTracker.serialize() }).to.throw(SyntaxError)
      })

      it('should throw an error when given wrong type for callback', function() {
        for (let i = 0; i < notFunctions.length; ++i) {
          expect(function() {
            currentTracker.serialize(notFunctions[i])
          }).to.throw(TypeError)
        }
      })

      it('should pass back no error when used after changes made', function() {
        currentTracker.serialize(function(err) {
          expect(err).to.not.be.an('error')
        })
      })

      it('should have created a dltracker.json file', function(done) {
        fs.stat(path.join(tempDir1, 'dltracker.json'), function(err, stats) {
          if (!err && !stats.isFile())
            err = new Error('dltracker.json is not a regular file')
          expect(err).to.not.be.an('error')
          done(err)
        })
      })
      
    })

    describe('For a new instance on a directory that has tarballs and a JSON file,', function() {
      before('create a tracker instance for data recovery tests', function(done) {
        maker.create(tempDir1, function(createErr, tracker) {
          currentTracker = tracker
          done(createErr)
        })
      })

      describe('getData()', function() {
        runCommon_getData_tests(true)
      })
      describe('contains()', function() {
        runCommon_contains_tests(true)
      })

      describe('audit()', function() {
        it('should throw an error when not given an argument', function() {
          expect(function() { currentTracker.audit() }).to.throw(SyntaxError)
        })

        it('should throw an error when given wrong type for callback', function() {
          for (let i = 0; i < notFunctions.length; ++i) {
            expect(function() {
              currentTracker.audit(notFunctions[i])
            }).to.throw(TypeError)
          }
        })

        it('should pass back no error and no results when all tarballs are accounted for', function(done) {
          currentTracker.audit(function(err, data) {
            if (err) return done(err)
            expect(data).to.be.an('array').that.has.length(0)
            done()
          })
        })

        let affected = 0

        function zeroFileAndTestAudit(filePath, next, done) {
          fs.writeFile(filePath, '', function(err) {
            if (err) return done(err)
            ++affected
            currentTracker.audit(function(err, data) {
              if (err) return done(err)
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
              rmAndTestAudit(filePath, next, done)
            })
          })
        }

        function rmAndTestAudit(filePath, next, done) {
          fs.unlink(filePath, function(err) {
            if (err) return done(err)
            currentTracker.audit(function(err, data) {
              if (err) return done(err)
              expect(data).to.be.an('array').that.has.length(affected)
              for (let i = 0; i < data.length; ++i) {
                expect(data[i]).to.have.property('data').that.is.an('object')
                expect(data[i]).to.have.property('error').that.is.an('error')
                expect(data[i].error.code).to.equal('ENOENT')
              }
              next()
            })
          })
        }

        it('should pass back an array of items when problems are detected', function(done) {
          const types = Object.keys(tarballNames)
          let nameIdx = 0;
          function nextRemoval(done) {
            if (types.length <= nameIdx) return done()
            const currName = tarballNames[types[nameIdx]]
            const filePath = path.resolve(tempDir1, currName)
            zeroFileAndTestAudit(
              filePath,
              function() {
                ++nameIdx
                nextRemoval(done)
              },
              done
            )
          }
          nextRemoval(done)
        })
      })

    })

    describe('For a new instance on a directory that has tarballs but no JSON file,', function() {
      before('create a tracker instance for data recovery tests', function(done) {
        // Fail if there is a dltracker.json in the governed directory
        fs.access(path.join(tempDir2, 'dltracker.json'), function(err, stats) {
          expect(err).to.be.an('error')

          // Iteratively copy all the tarballs into the governed directory
          mockAllDownloads(0, tempDir2, function(err) {
            if (err) return done(err)
            maker.create(tempDir2, function(createErr, tracker) {
              if (createErr) return done(createErr)
              currentTracker = tracker
              done()
            })
          })
        })
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

