-- Snapchat is gone: it never let apps post. Remove any Snapchat logins and their post entries.
DELETE FROM post_targets WHERE platform = 'snapchat';
DELETE FROM accounts WHERE platform = 'snapchat';
