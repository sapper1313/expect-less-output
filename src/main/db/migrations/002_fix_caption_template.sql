-- The first migration stored a literal backslash-n in the default caption template.
UPDATE brand_defaults SET caption_template = replace(caption_template, char(92) || 'n', char(10));
