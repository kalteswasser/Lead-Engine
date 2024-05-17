// imports
const { Builder, By, Key, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');


// api
let zefixAuth = btoa("moritz@kalteswasser.ch:GxGjq6hw")

// class
class Company {
    constructor(proposedName) {
        this.proposedName = proposedName;
    }

    async scrapeZefix() {
        const zefixSearchResponse = await fetch('https://www.zefix.admin.ch/ZefixPublicREST/api/v1/company/search', {
            method: 'POST',
            body: JSON.stringify({
                "name": this.proposedName,
            }),
            headers: {
                "Content-Type": "application/json",
                'Authorization': `Basic ${zefixAuth}`,
                "accept": "application/json"
            },
        });

        if (!zefixSearchResponse.ok) {
            throw new Error(`ZEFIX SEARCH: fetch request failed: ${zefixSearchResponse.response}`)
        }

        const zefixSearchData = await zefixSearchResponse.json();

        let companies = zefixSearchData.filter((c) => c.legalForm.name.de !== "Zweigniederlassung")

        if (companies.length === 0) {
            throw new Error(`ZEFIX SEARCH: couldn't find company`)
        }



        if (companies[0].status === "BEING_CANCELLED") throw new Error("ZEFIX SEARCH: Company is beeing liquidated")

        this.name = companies[0].name;
        this.uid = companies[0].uid;

        const HRSearchResponse = await fetch(`https://www.zefix.admin.ch/ZefixPublicREST/api/v1/company/uid/${this.uid}`, {
            method: 'GET',
            headers: {
                "Content-Type": "application/json",
                'Authorization': `Basic ${zefixAuth}`,
                "accept": "application/json",
            },
        });

        if (!HRSearchResponse.ok) {
            throw new Error(`ZEFIX EXCERPT: fetch request failed: ${HRSearchResponse.status}`)
        }

        const HRSearchData = await HRSearchResponse.json();

        if (HRSearchData.length === 0) {
            throw new Error(`ZEFIX EXCERPT: Data not found`)
        }

        this.excerpt = HRSearchData[0].cantonalExcerptWeb
        this.legalForm = HRSearchData[0].legalForm.shortName.de
        this.canton = HRSearchData[0].canton
        this.addressLine1 = HRSearchData[0].address.street + " " + HRSearchData[0].address.houseNumber
        this.city = HRSearchData[0].address.city
        this.zip = HRSearchData[0].address.swissZipCode
    }

    async scrapeDomain() {

        let options = new chrome.Options();
        options.addArguments(/*'--headless'*/); // Run Chrome in headless mode
        let driver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(options)
            .build();

        try {
            // Navigieren zu Google
            await driver.get(`https://duckduckgo.com/?t=h_&q=${this.name}`);

            // Warten, bis die Suchergebnisse geladen sind
            await driver.wait(until.elementLocated(By.css('.eVNpHGjtxRBq_gLOfGDr')), 10000);

            // Holen Sie sich den ersten Link aus den Suchergebnissen
            let firstResult = await driver.findElement(By.css('.eVNpHGjtxRBq_gLOfGDr'));
            let firstResultUrl = await firstResult.getAttribute('href');

            // Extrahieren Sie die Domain aus der URL
            let fullDomain = new URL(firstResultUrl).hostname;

            // Funktion zur Entfernung der Subdomain
            function extractRootDomain(domain) {
                let parts = domain.split('.');
                // Wenn die Domain drei Teile hat (z.B. www.example.com), entfernen Sie das erste Teil (Subdomain)
                if (parts.length > 2) {
                    parts.shift();
                }
                return parts.join('.');
            }

            this.domain = extractRootDomain(fullDomain);

        } finally {
            // Beenden Sie die WebDriver-Sitzung
            await driver.quit();
        }
    }

    async scrapeExcerpt() {

        if (this.excerpt === undefined) throw new Error('SCRAPE EXCERPT: Excerpt is not defined')

        let options = new chrome.Options();
        options.addArguments(/*'--headless'*/); // Run Chrome in headless mode
        let driver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(options)
            .build();

        try {
            // Navigate to the website
            await driver.get(this.excerpt);

            // old search
            // let parentElement = await driver.wait(until.elementLocated(By.xpath("/html/body/div[2]/div/form/div[2]/div[9]/div/table/tbody")), 10000);

            // Find the element containing the string "personalangaben"
            let element = await driver.wait(until.elementLocated(By.xpath("//*[contains(text(), 'Zeichnungsart')]")), 10000);

            // Get the 4th parent of that element
            let fourthParent = await element.findElement(By.xpath("ancestor::*[4]"));

            // Get the child element with the tag 'tbody' from the 4th parent
            let parentElement = await fourthParent.findElement(By.xpath(".//tbody"));


            let childElements = await parentElement.findElements(By.xpath('./*'));

            this.people = []

            for (let child of childElements) {
                let classes = await child.getAttribute('class');
                if (!classes.split(' ').includes("hideAndSeek")) {


                    let funktion = await (await child.findElement(By.xpath('./td[5]'))).getText()
                    let personalangaben = await (await child.findElement(By.xpath('./td[4]'))).getText()

                    let zeichnungsart = await (await child.findElement(By.xpath('./td[6]'))).getText()

                    if (funktion === "Revisionsstelle") {
                        let name = personalangaben.split(", ")[0]
                        let ort = personalangaben.split(", ")[1]

                        this.revisionsstelle = {
                            name: name,
                            location: ort,
                        }
                    } else {

                        if (personalangaben.split(", ").length == 2) continue;

                        // extract
                        let nachname = personalangaben.split(", ")[0]
                        let prefixes = ['von der', 'von', 'de', 'De', 'da', 'van', 'mc', 'di']

                        for (let prefix of prefixes) {
                            let re = new RegExp(`(?<=^|\\s)${prefix}\\s`, "g")
                            nachname = nachname.replace(re, prefix + "_")
                        }

                        nachname = nachname.split(" ")[0].replace("_", " ")


                        let vorname = personalangaben.split(", ")[1].trim().replace(/Dr\. |Prof\. /g, '').split(" ")[0]

                        let geburtsort = personalangaben.split(", ")[2]

                        let wohnort = personalangaben.split(", ")[3]


                        let codes = wohnort.match(/\(([^)]+)\)/g);

                        let swiss = true;

                        if (codes) {
                            let code = codes[codes.length - 1].slice(1, -1)

                            let cantons = ["AG", "AI", "AR", "BE", "BL", "BS", "FR", "GE", "GL", "GR", "JU", "LU", "NE", "NW", "OW", "SG", "SH", "SO", "SZ", "TG", "TI", "UR", "VD", "VS", "ZG", "ZH", "CH"]

                            if (!cantons.includes(code)) swiss = false;
                        }

                        this.people.push({
                            firstname: vorname,
                            lastname: nachname,
                            placeOfBirth: geburtsort,
                            placeOfResidence: wohnort,
                            function: funktion,
                            signature: zeichnungsart,
                            swiss: swiss
                        })
                    }
                }
            }

        } finally {

            await driver.quit()

        }
    }

    async identifyAP() {
        let functions = ['Inhaber', 'Vorsitzender der Geschäftsleitung', 'Generaldirektor', 'Direktor', 'Vorsitzender der Geschäftsführung', 'Geschäftsführer', 'Geschäftsführerin', 'Präsident des Verwaltungsrates', 'Präsidentin des Verwaltungsrates', 'Präsident des Stiftungsrates', 'Präsident', 'Mitglied des Verwaltungsrates', 'Mitglied', 'Mitglied der Geschäftsleitung', 'Mitglied der Direktion', ''];
        let signatures = ["Einzelunterschrift", "Einzelprokura", "Kollektivunterschrift zu zweien"]


        loop: for (let signature of signatures) {
            for (let role of functions) {
                for (let [i, person] of this.people.entries()) {
                    if (person.swiss && (person.function.includes(role) || role === '') && person.signature.includes(signature)) {
                        this.ap = i
                        break loop
                    }
                }
            }
        }

        if (this.ap === undefined) throw new Error(`IDENTIFY AP: No AP found`)

    }

    async findEmail() {

        if (this.ap === undefined) throw new Error("FIND EMAIL: No AP found")

        const response = await fetch(`https://api.hunter.io/v2/email-finder?domain=${this.domain}&first_name=${this.people[this.ap].firstname}&last_name=${this.people[this.ap].lastname}&api_key=e4ed3daa0d4263b51a5b460249d55576572bab17`, {
            method: 'GET',
        });

        if (!response.ok) {
            throw new Error(`FIND EMAIL: Hunter fetch request failed: ${response.response}`)
        }

        const data = await response.json();

        if (data.data.email === null) {
            throw new Error(`FIND EMAIL: Hunter couldn't find E-Mail`)
        }

        this.people[this.ap].email = {
            address: data.data.email,
            score: data.data.score
        }
    }

}

const main = async () => {
    let company = new Company("Clienia Littenheid AG")



    await company.scrapeZefix();
    await company.scrapeDomain();
    await company.scrapeExcerpt();
    await company.identifyAP();
    await company.findEmail()

    console.log(company)

}

main()
