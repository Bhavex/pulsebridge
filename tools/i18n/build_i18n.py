import json, sys, pathlib, re
S = pathlib.Path(sys.argv[1]); out = pathlib.Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
en = json.load(open(S / "en_strings.json"))
pats = ["years_active","years","asking","compatible","confirmed_days","got_it","thank_you","last_confirmed","hidden_in","received","sent","signed_in_as","accepted_on","matches","for_patient","needed_units_urgent","needed_units_soon","needed_units","number"]
ok = True
for f in sorted((S / "tr").glob("*.txt")):
    lang = f.stem; strings = {}; patterns = {}; seen = set()
    for line in f.read_text().splitlines():
        if not line.strip(): continue
        key, _, val = line.partition("\t")
        if key.startswith("@"): patterns[key[1:]] = val.strip(); continue
        i = int(key); seen.add(i); strings[en[i]] = val.strip()
    missing = [i for i in range(len(en)) if i not in seen]
    mp = [p for p in pats if p not in patterns]
    bad = [p for p, v in patterns.items() if v.count("$1") != 1 or ("$2" in v) != (p in ("years_active","last_confirmed","needed_units_urgent","needed_units_soon","needed_units"))]
    nums = [en[i] for i in seen if re.findall(r"\d+", en[i]) and sorted(re.findall(r"\d+", en[i])) != sorted(re.findall(r"\d+", strings[en[i]]))]
    print(lang, "strings", len(strings), "missing", missing, "missing patterns", mp, "bad patterns", bad, "number mismatches", len(nums))
    for n in nums[:8]: print("   ", n, "=>", strings[n])
    if missing or mp or bad: ok = False
    json.dump({"strings": strings, "patterns": patterns}, open(out / f"{lang}.json", "w"), ensure_ascii=False, separators=(",", ":"))
sys.exit(0 if ok else 1)
