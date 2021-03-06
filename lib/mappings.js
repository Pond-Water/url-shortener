var Nedb = require('nedb')
  , mappings = new Nedb({ filename: 'data/mappings.nedb', autoload: true })
  , utils = require('./utils')
  , url = require('url')
  ;

// Initialize mappings database
mappings.ensureIndex({ fieldName: 'from', unique: true });


/**
 * WEB
 * Show all created mappings
 */
function showAllMappings (req, res) {
  // NeDB sorting is slow as it doesn't use indexes. Shouldn't be an issue before we have more than 10,000 records so no worries
  mappings.find({}).sort({ from: 1 }).exec(function (err, mappingsList) {
    if (err) {
      return res.json(500, { message: 'Unexpected error while retrieving mappingsList from database'
                           , error: err
                           })
    }

    res.locals.mappings = mappingsList;
    return res.render('list.jade');
  });
}

/**
 * WEB
 * Show a specific mapping
 * Parameter :from
 */
function viewMapping (req, res) {
  if (!req.params.from) {
    // Could use a nicer 400 page ...
    return res.json(400, { message: 'from parameter missing'
                         })
  }

  mappings.findOne({ from: req.params.from }, function (err, mapping) {
    if (!mapping) {
      return res.status(404).json({ message: 'Mapping not found' });
    }

    res.locals.mapping = mapping;
    res.locals.sources = [];
    Object.keys(mapping.sources).forEach(function (domain) {
      if (domain !== 'Unknown') {
        res.locals.sources.push({ domain: domain.replace(/\[DOT\]/g, '.'), clicks: mapping.sources[domain] });   // Other side of the ugly hack below
      }
    });
    res.locals.sources = res.locals.sources.sort(function (a, b) { return b.clicks - a.clicks; });
    res.locals.sourceUnknown = mapping.sources.Unknown;

    return res.status(200).render('view.jade');
  });
}


/**
 * API
 * POST /mappings
 * Create a new mapping
 */
function createMapping (req, res) {
  if (!req.body.from) { return res.status(400).json({ from: 'missing' }); }
  if (!req.body.to) { return res.status(400).json({ to: 'missing' }); }

  var creator = 'Unknown user';
  if (req.session.user && req.session.user.name) {
    creator = req.session.user.name;
  }

  mappings.insert({ from: req.body.from, to: utils.normalizeUrl(req.body.to), createdAt: new Date(), clicks: 0, sources: {}, creator: creator }, function (err) {
    if (err) {
      if (err.errorType === 'uniqueViolated') {
        return res.status(403).json({ messages: ['The mapping name is already taken'] });
      } else {
        return res.status(500).json({ messages: ['Unexpected server error'] });
      }
    }

    return res.status(200).json({});
  });
}


/**
 * The actual redirection for all mappings
 */
function redirect (req, res) {
  if (!req.params.from) { req.params.from = ''; }

  mappings.findOne({ from: req.params.from }, function (err, mapping) {
    if (err) {
      return res.status(500).json({ message: 'Unexpected server error' });
    }

    if (!mapping) {
      return res.status(400).json({ from: 'Unknown' });
    }

    // Find out where this click comes from
    var referrer = req.headers.referer;
    if (referrer) {
      referrer = url.parse(referrer);
      referrer = referrer.host || referrer.hostname
    }
    // Special cases
    if (referrer === 't.co') { referrer = 'twitter.com'; }
    if (referrer && referrer.match(/^www\.(.*)$/)) { referrer = referrer.match(/^www\.(.*)$/)[1]; }
    if (referrer === undefined) { referrer = 'Unknown'; }
    referrer = referrer.replace(/\./g, '[DOT]');   // Necessary since dot has a special meaning with NeDB. Not proud of this hack ...

    var updateQuery = { $inc: { clicks: 1 } };
    updateQuery.$inc['sources.' + referrer] = 1;

    mappings.update({ _id: mapping._id }, updateQuery, {}, function () {
      if (err) {
        console.log("Couldn't update the clicks count on mapping " + mapping._id);
      }
      // Even if error do the redirect that's the most important
      return res.redirect(302, mapping.to);
    });
  });
}


// Interface
module.exports.showAllMappings = showAllMappings;
module.exports.createMapping = createMapping;
module.exports.redirect = redirect;
module.exports.viewMapping = viewMapping;
