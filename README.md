# npm-package-dl-tracker
Package tarball data store manager for the **npm-two-stage** project

## Overview
The  purposes of this module are:
* to associate critical installation-related data with downloaded package tarballs
* to help the package downloader avoid redundant downloads 
* to provide information to the **offliner** module for installation of downloaded packages
* to provide a means to validate the information mapped in a dltracker.json file with respect to the download directory that contains it

Where package tarball filenames (and Git repo identifiers) are of concern, this module is meant to be used in tandem with the module **npm-package-filename**.


## Install

```bash
npm install npm-package-dl-tracker
````


## Usage

```js
const trackerMaker = require('npm-package-dl-tracker')

// ...

trackerMaker.create('path/to/put/tarballs', function(err, tracker) {
  if (err) return fallback(err)
  proceedWithTracker(tracker)
})

// ...

const inData = {
  name: pkgName,
  version: pkgVer,
  filename: uniqueFilename,
  // whatever else is useful...
}
tracker.add('semver', inData, function(err) {
  if (err) return fallback(err)
  next()
})

tracker.contains('semver', pkgName, pkgVer) // --> true

// ...

const outData = tracker.getData('semver', pkgName, pkgVer)
/* -->
  outData contains everything in inData, with the additional field 'type'
*/

// ...

tracker.serialize(function(err) {
  if (err) return abort(err)
  finishUp()
}
```


## Module API

### `trackerMaker.typeMap`
A hash of `npm-package-arg` package types to `npm-package-dl-tracker` package types.
```js
trackerMaker.typeMap['version'] // --> 'semver'
trackerMaker.typeMap['tag']     // --> 'tag'
trackerMaker.typeMap['git']     // --> 'git'
trackerMaker.typeMap['remote']  // --> 'url'
trackerMaker.typeMap['file']    // --> undefined
```

A value obtained from this mapping is to be used as the first argument to instance methods `add()`, `contains()`, and `get()`.

Only covers the ones that are meaningful in this context.

### `trackerMaker.create(where, cb)`
Factory function to instantiate a tracker instance.
* `where` {string || `undefined` || `null`} Path to put/find tarballs

  If empty value is given, the current directory will be used.

* `cb` {function} Callback
  * `error` {Error || `null`}
  * `tracker` {object} New download-tracker instance, if no error

## Instance API

### `tracker.path`
{string} The absolute path adopted by this instance for location of tarballs

### `tracker.add(type, data, cb)`
* `type` {string} One of the values from **`trackerMaker.typeMap`** (see above)
* `data` {object} Contains fields to associate with a given tarball.
  Arbitrary extra fields may be included with required fields.

  For `type` `'semver'`, required fields are:
  * `name` {string}
  * `version` {string}
  * `filename` {string} The name of the tarball file

  For `type` `'tag'`, required fields are same as for `'semver'` with one more:
  * `spec` {string} The tag

  For `type` `'git'`, required fields are:
  * `repo` {string} A unique identifier for a git repository
  * `commit` {string} The git hash that identifies a commit in the given repository
  * `filename` {string} The name of the tarball file

  For `type` `'url'`, required fields are:
  * `spec` {string} A remote URL
  * `filename` {string} The name of the tarball file

* `cb` {function} Callback
  * `error` {Error || `undefined`}

### `tracker.contains(type, name, spec)`
*Synchronous*
* `type` {string} One of the values from **`trackerMaker.typeMap`** (see above)
* `name` {string}

  For `type` `'semver'` or `'tag'`, must be the package name

  For `type` `'git'`, must be the git repo identifier (see **`tracker.add()`** above)

  For `type` `'url'`, must be empty (`''` || `null` || `undefined`)

* `spec` {string}

  For `type` `'semver'`, must be the package version

  For `type` `'tag'`, must be the version tag

  For `type` `'git'`, must be the git hash that identifies a commit

  For `type` `'url'`, must be a remote URL

* Returns: {boolean} Whether the identified package has been added

***Caveat:*** For `type` `'tag'`, if the value of `spec` is `'latest'` or `''`, the call will tell if *any* version of the named package has been added.

### `tracker.getData(type, name, spec)`
*Synchronous*

Same argument requirements as for `contains()`.
* Returns: {object || `null`}

  If the identified package was previously added, this will contain the same data passed to `tracker.add()`, with the additional field `type`.

***Caveat:*** For `type` `'tag'`, if the value of `spec` is `'latest'` or `''`, the call will return the data of the highest version added, which is not necessarily the current latest version.

### `tracker.serialize(cb)`
Writes the current modified state to the file `dltracker.json` in the adopted directory (**`tracker.path`**).
Does nothing if there has not been a call to **`tracker.add()`** since instantiation or since the last call to **`tracker.serialize()`**.
* `cb` {function} Callback
  * `error` {Error || `undefined`}

### `tracker.audit(cb)`
Runs checks on the items in the current data, including the condition of each file.
* `cb` {function} Callback
  * `error` {Error || `null`}
  * `list` {Array} A list of objects describing problems discovered in the current tracker data, if any:
    * `data` {object} The same data as returned by `tracker.getData()`
    * `error` {Error} The error encountered for the package identified by `data`

------

**License: Artistic 2.0**
