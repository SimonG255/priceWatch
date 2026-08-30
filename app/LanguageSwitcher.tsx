"use client";

import { useEffect, useState } from "react";

type Locale = "en" | "sl" | "de";

const slDashboard: Record<string, string> = {
  "Product search": "Iskanje izdelkov", Products: "Izdelki", "Admin profiles": "Skrbniški profili", "Manage plan": "Upravljanje paketa", "Sign out": "Odjava", "Delete workspace data": "Izbriši podatke delovnega prostora",
  "Import Excel": "Uvozi Excel", "Export Excel": "Izvozi Excel", "YOUR WEBSITES": "VAŠE SPLETNE STRANI", "Add websites, then select where to search": "Dodajte spletne strani in izberite, kje iskati", "Save each public store once. Select one or many websites for manual searches and Excel imports.": "Vsako javno trgovino shranite enkrat. Izberite eno ali več strani za ročna iskanja in uvoz iz Excela.", "Website URL": "URL spletne strani", "Add website": "Dodaj spletno stran", "Select all": "Izberi vse", Clear: "Počisti", "No websites added yet.": "Dodana ni še nobena spletna stran.",
  "BULK PRODUCT SEARCH": "MNOŽIČNO ISKANJE IZDELKOV", "Search multiple products on multiple websites": "Iščite več izdelkov na več spletnih straneh", "Product name": "Naziv izdelka", optional: "neobvezno", "Your price": "Vaša cena", "Add another product": "Dodaj izdelek", "Existing combinations are updated without creating duplicates.": "Obstoječe kombinacije se posodobijo brez dvojnikov.", "Add & search combinations": "Dodaj in poišči kombinacije", "How Nexus chooses a website search URL": "Kako Nexus izbere iskalni URL spletne strani",
  "Matches found": "Najdena ujemanja", "Prices captured": "Zajete cene", Waiting: "Čakanje", "EAN or name + price": "EAN ali naziv + cena", "Latest public results": "Najnovejši javni rezultati", "Queued or searching": "V čakalni vrsti ali iskanju",
  "Monitored products": "Spremljani izdelki", "Each product appears once; the site tags show everywhere it is searched.": "Vsak izdelek je prikazan enkrat; oznake kažejo vse strani iskanja.", "Bulk import": "Množični uvoz", Site: "Stran", "All sites": "Vse strani", Stock: "Zaloga", "All stock": "Vsa zaloga", "In stock": "Na zalogi", "Out of stock": "Ni na zalogi", Unknown: "Neznano", Scan: "Preverjanje", "All statuses": "Vsi statusi", Found: "Najdeno", Queued: "V čakalni vrsti", Searching: "Iskanje", Blocked: "Blokirano", "Not found": "Ni najdeno", "Needs review": "Potreben pregled", Unavailable: "Nedosegljivo", "Price from": "Cena od", "Price to": "Cena do", Any: "Poljubno", "Price drops": "Padci cen", "Needs attention": "Zahteva pozornost",
  Rescan: "Preveri znova", "Pause monitoring": "Začasno ustavi", "Resume monitoring": "Nadaljuj spremljanje", Export: "Izvozi", Delete: "Izbriši", "No products match these filters": "Noben izdelek ne ustreza filtrom", "No products yet": "Ni še izdelkov", "Try another filter or clear the search.": "Poskusite drug filter ali počistite iskanje.", "Add one above, or import many products from Excel.": "Dodajte izdelek zgoraj ali jih uvozite iz Excela.", Product: "Izdelek", "Sites searched": "Preiskane strani", Result: "Rezultat", Prices: "Cene", "Last checked": "Zadnji pregled", Actions: "Dejanja", Never: "Nikoli", "No SKU": "Brez SKU", "View price history": "Prikaži zgodovino cen", "Hide price history": "Skrij zgodovino cen",
  "PRICE HISTORY": "ZGODOVINA CEN", Current: "Trenutna", Lowest: "Najnižja", Highest: "Najvišja", Average: "Povprečna", "Scan transparency": "Preglednost preverjanja", "Why each site has its current status": "Zakaj ima vsaka stran trenutni status", Retry: "Poskusi znova", "Price alerts": "Opozorila o cenah",
  "Import products from Excel": "Uvozi izdelke iz Excela", "Websites to search": "Spletne strani za iskanje", "Select websites": "Izberi spletne strani", "Fill in name and EAN": "Vnesi naziv in EAN", "Upload the .xlsx file": "Naloži datoteko .xlsx", "Download Excel template": "Prenesi Excelovo predlogo", "Choose Excel file": "Izberi Excelovo datoteko", "Select a website first": "Najprej izberite spletno stran",
  "Tracked product": "Spremljani izdelek", "No tracked history yet": "Ni še zgodovine", "No snapshots yet": "Ni še posnetkov", "Fair scheduled monitoring": "Pravično načrtovano spremljanje", Frequency: "Pogostost", "Every hour": "Vsako uro", "Every 6 hours": "Vsakih 6 ur", "Twice daily": "Dvakrat dnevno", Daily: "Dnevno", Weekly: "Tedensko", "Schedule exists": "Urnik obstaja", "Create schedule": "Ustvari urnik", "Not run yet": "Še ni zagnano", Enabled: "Omogočeno", Paused: "Začasno ustavljeno", "Run now": "Zaženi zdaj"
};

const deDashboard: Record<string, string> = {
  "Product search": "Produktsuche", Products: "Produkte", "Admin profiles": "Admin-Profile", "Manage plan": "Tarif verwalten", "Sign out": "Abmelden", "Delete workspace data": "Workspace-Daten löschen",
  "Import Excel": "Excel importieren", "Export Excel": "Excel exportieren", "YOUR WEBSITES": "IHRE WEBSITES", "Add websites, then select where to search": "Websites hinzufügen und Suchorte auswählen", "Save each public store once. Select one or many websites for manual searches and Excel imports.": "Speichern Sie jeden öffentlichen Shop einmal. Wählen Sie eine oder mehrere Websites für manuelle Suchen und Excel-Importe.", "Website URL": "Website-URL", "Add website": "Website hinzufügen", "Select all": "Alle auswählen", Clear: "Leeren", "No websites added yet.": "Noch keine Websites hinzugefügt.",
  "BULK PRODUCT SEARCH": "MEHRFACHE PRODUKTSUCHE", "Search multiple products on multiple websites": "Mehrere Produkte auf mehreren Websites suchen", "Product name": "Produktname", optional: "optional", "Your price": "Ihr Preis", "Add another product": "Weiteres Produkt", "Existing combinations are updated without creating duplicates.": "Bestehende Kombinationen werden ohne Duplikate aktualisiert.", "Add & search combinations": "Kombinationen hinzufügen und suchen", "How Nexus chooses a website search URL": "Wie Nexus eine Website-Such-URL auswählt",
  "Matches found": "Treffer gefunden", "Prices captured": "Preise erfasst", Waiting: "Wartend", "EAN or name + price": "EAN oder Name + Preis", "Latest public results": "Neueste öffentliche Ergebnisse", "Queued or searching": "In Warteschlange oder Suche",
  "Monitored products": "Überwachte Produkte", "Each product appears once; the site tags show everywhere it is searched.": "Jedes Produkt erscheint einmal; Website-Tags zeigen alle Suchorte.", "Bulk import": "Massenimport", Site: "Website", "All sites": "Alle Websites", Stock: "Bestand", "All stock": "Alle Bestände", "In stock": "Auf Lager", "Out of stock": "Nicht auf Lager", Unknown: "Unbekannt", Scan: "Prüfung", "All statuses": "Alle Status", Found: "Gefunden", Queued: "Warteschlange", Searching: "Suche", Blocked: "Blockiert", "Not found": "Nicht gefunden", "Needs review": "Prüfung nötig", Unavailable: "Nicht verfügbar", "Price from": "Preis ab", "Price to": "Preis bis", Any: "Beliebig", "Price drops": "Preissenkungen", "Needs attention": "Aufmerksamkeit nötig",
  Rescan: "Erneut prüfen", "Pause monitoring": "Überwachung pausieren", "Resume monitoring": "Überwachung fortsetzen", Export: "Exportieren", Delete: "Löschen", "No products match these filters": "Keine Produkte entsprechen den Filtern", "No products yet": "Noch keine Produkte", "Try another filter or clear the search.": "Versuchen Sie einen anderen Filter oder leeren Sie die Suche.", "Add one above, or import many products from Excel.": "Fügen Sie oben ein Produkt hinzu oder importieren Sie mehrere aus Excel.", Product: "Produkt", "Sites searched": "Durchsuchte Websites", Result: "Ergebnis", Prices: "Preise", "Last checked": "Zuletzt geprüft", Actions: "Aktionen", Never: "Nie", "No SKU": "Keine SKU", "View price history": "Preishistorie anzeigen", "Hide price history": "Preishistorie ausblenden",
  "PRICE HISTORY": "PREISHISTORIE", Current: "Aktuell", Lowest: "Niedrigster", Highest: "Höchster", Average: "Durchschnitt", "Scan transparency": "Prüftransparenz", "Why each site has its current status": "Warum jede Website ihren aktuellen Status hat", Retry: "Erneut versuchen", "Price alerts": "Preisalarme",
  "Import products from Excel": "Produkte aus Excel importieren", "Websites to search": "Zu durchsuchende Websites", "Select websites": "Websites auswählen", "Fill in name and EAN": "Name und EAN eingeben", "Upload the .xlsx file": ".xlsx-Datei hochladen", "Download Excel template": "Excel-Vorlage herunterladen", "Choose Excel file": "Excel-Datei auswählen", "Select a website first": "Zuerst eine Website auswählen",
  "Tracked product": "Überwachtes Produkt", "No tracked history yet": "Noch keine Historie", "No snapshots yet": "Noch keine Momentaufnahmen", "Fair scheduled monitoring": "Faire geplante Überwachung", Frequency: "Häufigkeit", "Every hour": "Stündlich", "Every 6 hours": "Alle 6 Stunden", "Twice daily": "Zweimal täglich", Daily: "Täglich", Weekly: "Wöchentlich", "Schedule exists": "Zeitplan vorhanden", "Create schedule": "Zeitplan erstellen", "Not run yet": "Noch nicht ausgeführt", Enabled: "Aktiviert", Paused: "Pausiert", "Run now": "Jetzt ausführen"
};

const sl: Record<string, string> = {
  ...slDashboard,
  "How it works": "Kako deluje", Pricing: "Cenik", "Responsible data": "Odgovorni podatki", "Sign in": "Prijava", "Start free trial": "Začni brezplačni preizkus",
  "14-day free trial · Early access": "14-dnevni brezplačni preizkus · Zgodnji dostop", "Know when the": "Vedite, kdaj se", "market ": "trg ", "moves.": "premakne.",
  "Nexus checks competitor product pages, records price and stock changes, and tells you exactly when it is time to act.": "Nexus preverja strani izdelkov konkurentov, beleži spremembe cen in zaloge ter pove, kdaj je čas za ukrepanje.",
  "Start 14-day free trial": "Začni 14-dnevni brezplačni preizkus", "See the product": "Oglej si izdelek", "14 days free": "14 dni brezplačno", "No credit card": "Brez kreditne kartice", "Cancel anytime": "Prekličite kadar koli",
  "Built for teams that cannot afford to discover price changes too late": "Za ekipe, ki si ne morejo privoščiti prepoznega odkritja sprememb cen", "Independent shops": "Neodvisne trgovine", "DTC brands": "DTC znamke", Marketplaces: "Tržnice", "Category managers": "Vodje kategorij", "Online retailers": "Spletni trgovci",
  "A SIMPLE DAILY ADVANTAGE": "PREPROSTA DNEVNA PREDNOST", "From website and EAN to": "Od spletne strani in EAN do", "a verified product match.": "preverjenega ujemanja izdelka.", "Add one product or import an entire Excel catalogue.": "Dodajte en izdelek ali uvozite celoten Excelov katalog.",
  "Enter website, name & EAN": "Vnesite spletno stran, naziv in EAN", "We search public pages": "Preiščemo javne strani", "Import or export Excel": "Uvozite ali izvozite Excel",
  "DESIGNED FOR DECISIONS": "ZASNOVANO ZA ODLOČITVE", "Your market, without": "Vaš trg brez", "the manual checking.": "ročnega preverjanja.", "Price history that compounds": "Zgodovina cen, ki pridobiva vrednost", "Alerts with context": "Opozorila s kontekstom", "Stock intelligence": "Pregled nad zalogo",
  "RESPONSIBLE BY DESIGN": "ODGOVORNO PO ZASNOVI", "Useful monitoring.": "Uporabno spremljanje.", "Respectful collection.": "Spoštljivo zbiranje.", "Public product pages only": "Samo javne strani izdelkov", "Reasonable request rates": "Razumna pogostost zahtev", "Caching to avoid repeat fetches": "Predpomnjenje brez ponavljajočih zahtev", "No CAPTCHA or paywall bypass": "Brez obhoda CAPTCHA ali plačljivih zidov",
  "CLEAR, URL-BASED PRICING": "JASNE CENE GLEDE NA URL-JE", "Start small. Scale when the": "Začnite majhno. Razširite, ko", "signal proves valuable.": "se signal izkaže za koristnega.", "Try every plan free for 14 days. Hosting and AI-assisted monitoring are included.": "Vsak paket preizkusite 14 dni brezplačno. Gostovanje in spremljanje z UI sta vključena.", Starter: "Začetni", Business: "Poslovni", "/month": "/mesec", "14-day free trial": "14-dnevni brezplačni preizkus", "150 monitored URLs": "150 spremljanih URL-jev", "350 monitored URLs": "350 spremljanih URL-jev", "1,500 monitored URLs": "1.500 spremljanih URL-jev", "Daily price checks": "Dnevno preverjanje cen", "Price history": "Zgodovina cen", "AI-assisted recovery": "Obnova s pomočjo UI", "4 checks per day": "4 preverjanja na dan", "Email alerts": "E-poštna opozorila", "Stock monitoring": "Spremljanje zaloge", "Frequent checks": "Pogosta preverjanja", "CSV and API export": "Izvoz CSV in API", "Priority AI-assisted recovery": "Prednostna obnova s pomočjo UI", "MOST POPULAR": "NAJBOLJ PRILJUBLJEN",
  "COMMON QUESTIONS": "POGOSTA VPRAŠANJA", "Good to know": "Dobro je vedeti", "before you start.": "pred začetkom.", "Which websites can Nexus monitor?": "Katere spletne strani lahko Nexus spremlja?", "What information do I enter?": "Katere podatke vnesem?", "Can I add many products?": "Ali lahko dodam veliko izdelkov?", "Can Nexus bypass blocked pages?": "Ali lahko Nexus obide blokirane strani?",
  "YOUR NEXT PRICE CHANGE IS COMING": "PRIHAJA NASLEDNJA SPREMEMBA CENE", "See it before it": "Opazite jo, preden", "costs you margin.": "vas stane marže.", "Privacy": "Zasebnost", Terms: "Pogoji"
};

const de: Record<string, string> = {
  ...deDashboard,
  "How it works": "So funktioniert es", Pricing: "Preise", "Responsible data": "Verantwortungsvolle Daten", "Sign in": "Anmelden", "Start free trial": "Kostenlos testen",
  "14-day free trial · Early access": "14 Tage kostenlos · Frühzugang", "Know when the": "Wissen, wann sich der", "market ": "Markt ", "moves.": "bewegt.", "Nexus checks competitor product pages, records price and stock changes, and tells you exactly when it is time to act.": "Nexus prüft Produktseiten der Konkurrenz, zeichnet Preis- und Bestandsänderungen auf und zeigt, wann Handlungsbedarf besteht.", "Start 14-day free trial": "14 Tage kostenlos testen", "See the product": "Produkt ansehen", "14 days free": "14 Tage kostenlos", "No credit card": "Keine Kreditkarte", "Cancel anytime": "Jederzeit kündbar",
  "Built for teams that cannot afford to discover price changes too late": "Für Teams, die Preisänderungen nicht zu spät entdecken dürfen", "Independent shops": "Unabhängige Shops", "DTC brands": "DTC-Marken", Marketplaces: "Marktplätze", "Category managers": "Category Manager", "Online retailers": "Onlinehändler",
  "A SIMPLE DAILY ADVANTAGE": "EIN EINFACHER TÄGLICHER VORTEIL", "From website and EAN to": "Von Website und EAN zum", "a verified product match.": "verifizierten Produkttreffer.", "Add one product or import an entire Excel catalogue.": "Fügen Sie ein Produkt hinzu oder importieren Sie einen vollständigen Excel-Katalog.", "Enter website, name & EAN": "Website, Name und EAN eingeben", "We search public pages": "Wir durchsuchen öffentliche Seiten", "Import or export Excel": "Excel importieren oder exportieren",
  "DESIGNED FOR DECISIONS": "FÜR ENTSCHEIDUNGEN ENTWICKELT", "Your market, without": "Ihr Markt, ohne", "the manual checking.": "manuelle Prüfung.", "Price history that compounds": "Wertvolle Preishistorie", "Alerts with context": "Warnungen mit Kontext", "Stock intelligence": "Bestandsinformationen",
  "RESPONSIBLE BY DESIGN": "VERANTWORTUNGSVOLL ENTWICKELT", "Useful monitoring.": "Nützliches Monitoring.", "Respectful collection.": "Respektvolle Erfassung.", "Public product pages only": "Nur öffentliche Produktseiten", "Reasonable request rates": "Angemessene Abfrageraten", "Caching to avoid repeat fetches": "Caching gegen wiederholte Abrufe", "No CAPTCHA or paywall bypass": "Keine Umgehung von CAPTCHA oder Paywalls",
  "CLEAR, URL-BASED PRICING": "KLARE URL-BASIERTE PREISE", "Start small. Scale when the": "Klein anfangen. Skalieren, wenn", "signal proves valuable.": "das Signal Mehrwert schafft.", "Try every plan free for 14 days. Hosting and AI-assisted monitoring are included.": "Testen Sie jeden Tarif 14 Tage kostenlos. Hosting und KI-gestütztes Monitoring sind enthalten.", "/month": "/Monat", "14-day free trial": "14 Tage kostenlos testen", "150 monitored URLs": "150 überwachte URLs", "350 monitored URLs": "350 überwachte URLs", "1,500 monitored URLs": "1.500 überwachte URLs", "Daily price checks": "Tägliche Preisprüfungen", "Price history": "Preishistorie", "AI-assisted recovery": "KI-gestützte Wiederherstellung", "4 checks per day": "4 Prüfungen pro Tag", "Email alerts": "E-Mail-Benachrichtigungen", "Stock monitoring": "Bestandsüberwachung", "Frequent checks": "Häufige Prüfungen", "CSV and API export": "CSV- und API-Export", "Priority AI-assisted recovery": "Priorisierte KI-Wiederherstellung", "MOST POPULAR": "BELIEBTESTER TARIF",
  "COMMON QUESTIONS": "HÄUFIGE FRAGEN", "Good to know": "Gut zu wissen", "before you start.": "bevor Sie starten.", "Which websites can Nexus monitor?": "Welche Websites kann Nexus überwachen?", "What information do I enter?": "Welche Angaben muss ich machen?", "Can I add many products?": "Kann ich viele Produkte hinzufügen?", "Can Nexus bypass blocked pages?": "Kann Nexus gesperrte Seiten umgehen?",
  "YOUR NEXT PRICE CHANGE IS COMING": "DIE NÄCHSTE PREISÄNDERUNG KOMMT", "See it before it": "Erkennen Sie sie, bevor", "costs you margin.": "sie Marge kostet.", Privacy: "Datenschutz", Terms: "Bedingungen"
};

const dictionaries = { sl, de };
const originals = new WeakMap<Text, string>();

export default function LanguageSwitcher() {
  const [locale, setLocale] = useState<Locale>("en");
  useEffect(() => {
    const queryLang = new URLSearchParams(location.search).get("lang");
    const savedLang = localStorage.getItem("nexus-language");
    const lang = queryLang || savedLang;
    if (lang === "sl" || lang === "de") queueMicrotask(() => setLocale(lang));
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    localStorage.setItem("nexus-language", locale);
    const translate = (root: Node) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let current: Node | null;
      while ((current = walker.nextNode())) {
        const node = current as Text;
        const source = originals.get(node) ?? node.data;
        originals.set(node, source);
        const key = source.trim();
        if (!key) continue;
        const value = locale === "en" ? key : dictionaries[locale][key] ?? key;
        node.data = source.replace(key, value);
      }
    };
    translate(document.body);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) for (const node of mutation.addedNodes) translate(node);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [locale]);
  function choose(next: Locale) { setLocale(next); localStorage.setItem("nexus-language", next); const url = new URL(location.href); if (next === "en") url.searchParams.delete("lang"); else url.searchParams.set("lang", next); history.replaceState({}, "", url); }
  return <div className="language-switcher" aria-label="Language"><button className={locale === "en" ? "active" : ""} onClick={() => choose("en")}>EN</button><button className={locale === "sl" ? "active" : ""} onClick={() => choose("sl")}>SL</button><button className={locale === "de" ? "active" : ""} onClick={() => choose("de")}>DE</button></div>;
}
