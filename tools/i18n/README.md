# Translations

`en_strings.json` lists every English string on the site. Each file in `tr/` has one line per string: its number, a tab, then the translation. Lines starting with `@` are sentence templates where `$1` and `$2` stand for names, dates or numbers.

After editing a file in `tr/`, rebuild the site dictionaries:

```
python3 tools/i18n/build_i18n.py tools/i18n js/i18n
```

If you add new English text to a page, add it to the end of `en_strings.json` and add a matching numbered line to every file in `tr/`.
