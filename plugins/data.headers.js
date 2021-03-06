// validate message headers and some fields

exports.register = function () {
    var plugin = this;

    this.register_hook('data_post', 'duplicate_singular');
    this.register_hook('data_post', 'missing_required');
    this.register_hook('data_post', 'invalid_date');
    this.register_hook('data_post', 'invalid');
};

exports.duplicate_singular = function(next, connection) {
    var config = this.config.get('data.headers.ini');

    // RFC 5322 Section 3.6, Headers that MUST be unique if present
    var singular = config.main.singular !== undefined
                 ? config.main.singular.split(',')
                 : ['Date', 'From', 'Sender', 'Reply-To', 'To', 'Cc',
                    'Bcc', 'Message-Id', 'In-Reply-To', 'References',
                    'Subject'];

    for (var i=0, l=singular.length; i < l; i++) {
        if (connection.transaction.header.get_all(singular[i]).length > 1) {
             return next(DENY, "Only one " + singular[i]
                 + " header allowed. See RFC 5322, Section 3.6");
        }
    };

    return next();
};

exports.missing_required = function(next, connection) {
    var config = this.config.get('data.headers.ini');

    // Enforce RFC 5322 Section 3.6, Headers that MUST be present
    var required = config.main.required !== undefined
                 ? config.main.required.split(',')
                 : ['Date', 'From'];

    for (var i=0, l=required.length; i < l; i++) {
        if (connection.transaction.header.get_all(required[i]).length === 0) {
            return next(DENY, "Required header '" + required[i] + "' missing");
        }
    }

    return next();
};

exports.invalid = function(next, connection) {
    // This tests for headers that shouldn't be present

    // RFC 5321#section-4.4 Trace Information
    //   A message-originating SMTP system SHOULD NOT send a message that
    //   already contains a Return-path header field.

    // Return-Path, aka Reverse-PATH, Envelope FROM, RFC5321.MailFrom
    var rp = connection.transaction.header.get('Return-Path');
    var plugin = this;
    if (rp) {
        if (connection.relaying) {      // On messages we originate
            connection.loginfo(plugin, "invalid Return-Path!");
            return next(DENY, "outgoing mail must not have a Return-Path header (RFC 5321)");
        }
        else {
            // generally, messages from the internet shouldn't have a
            // Return-Path, except for when they can. Read RFC 5321, it's
            // complicated. In most cases, The Right Thing to do here is to
            // strip the Return-Path header.
            connection.transaction.remove_header('Return-Path');
            // unless it was added by Haraka. Which at present, doesn't.
        };
    };

    // other invalid tests here...
    return next();
};

exports.invalid_date = function (next, connection) {
    var plugin = this;
    // Assure Date header value is [somewhat] sane

    var config = this.config.get('data.headers.ini');
    var msg_date = connection.transaction.header.get_all('Date');
    if (!msg_date || msg_date.length === 0) return next();

    connection.logdebug(plugin, "message date: " + msg_date);
    msg_date = Date.parse(msg_date);

    var date_future_days = config.main.date_future_days !== 'undefined'
                         ? config.main.date_future_days
                         : 2;

    if (date_future_days > 0) {
        var too_future = new Date;
        too_future.setHours(too_future.getHours() + 24 * date_future_days);
        // connection.logdebug(plugin, "too future: " + too_future);
        if (msg_date > too_future) {
            connection.loginfo(plugin, "date is newer than: " + too_future );
            return next(DENY, "The Date header is too far in the future");
        };
    }

    var date_past_days   = config.main.date_past_days !== 'undefined'
                         ? config.main.date_past_days
                         : 15;

    if (date_past_days > 0) {
        var too_old = new Date;
        too_old.setHours(too_old.getHours() - 24 * date_past_days);
        // connection.logdebug(plugin, "too old: " + too_old);
        if (msg_date < too_old) {
            connection.loginfo(plugin, "date is older than: " + too_old);
            return next(DENY, "The Date header is too old");
        };
    };

    return next();
};
