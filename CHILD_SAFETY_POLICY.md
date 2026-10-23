# ChatWave Child Safety & Age-Appropriate Design — Publication Draft

**Status:** Product and legal review draft. Do not publish until the operator, reporting contacts, escalation team, service providers, country-specific age rules, and working response process are in place.

**Operator:** `[Full legal entity name]`  
**Safety contact:** `[safety email / web form]`  
**Guardian contact:** `[guardian support route]`  
**Effective date:** `[date]`

## 1. Purpose and scope

ChatWave is designed as a social service that may be used by young people. This draft sets out the proposed age-appropriate design, privacy, reporting, and response standards for accounts, posts, videos, Reels, stories, comments, groups, channels, and direct messages. It does not replace country-specific legal advice or an operational child-safeguarding program.

## 2. Age screening and account access

Before collecting a phone number or other account data, show a neutral date-of-birth and country/region screen. Determine each user’s age band and applicable local pathway. Do not treat a checkbox, a self-reported birth date, or a country dropdown as verified parental consent. If a law requires parental permission or a particular age-assurance method, do not enable the affected processing until an appropriate method and guardian workflow are operating.

The current prototype applies a conservative under-18 preview gate. It does not create a real minor account or verify a guardian. This prototype threshold is a design precaution, not a statement of the legal minimum age in every country. The production policy must define separate outcomes for each launch market, including age-appropriate features and a safe route for a user who cannot complete verification.

For services covered by the US Children’s Online Privacy Protection Rule, configure a compliant notice and verifiable parental consent process before collecting personal information from a child under 13 when required. The FTC’s 2025 amendments include separate parental consent for certain disclosures and limits on retaining children’s data. The product must not use an age gate as a substitute for those duties. [FTC COPPA guidance](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions) · [FTC 2025 final rule](https://www.ftc.gov/legal-library/browse/federal-register-notices/16-cfr-part-312-coppa-final-rule-amendments)

For the UK, complete and maintain a children’s data protection impact assessment and apply the ICO Children’s Code where the service is likely to be accessed by children. For EU markets, configure the age for a child’s consent to information-society services by Member State and assess other lawful bases and child protections separately. Do not use a single global age value as legal eligibility. [ICO Children’s Code](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/) · [European Commission: children’s data rights](https://commission.europa.eu/law/law-topic/data-protection/information-individuals_en)

## 3. Default protections for youth accounts

Where local law and the actual age-assurance result identify a child or teen account, use privacy-protective defaults. The production service should:

- set the profile and posts to private or the strongest age-appropriate audience by default;
- prevent discovery through phone number, precise location, or contact upload unless separately justified and controlled;
- limit unsolicited direct messages, group invitations, tagging, and contact from unknown adults;
- provide blocking, muting, reporting, and restricted-contact controls that are easy to find;
- avoid publicly showing date of birth, school, precise location, or routine patterns;
- avoid targeted advertising, profiling, or recommendation practices that are disallowed or inappropriate for the user’s age;
- explain each privacy choice in age-appropriate language and make controls usable without guardian access where the law gives the child independent rights;
- apply data minimisation and a documented retention schedule to account, message, report, and verification records.

The actual controls must be enforced server-side across search, feeds, recommendations, message requests, downloads, and APIs. A front-end toggle is not a security boundary.

## 4. Content, contact, and moderation safety

Publish understandable rules that prohibit child sexual exploitation or abuse, grooming, sexualization of minors, coercion, threats, stalking, bullying, non-consensual intimate imagery, and attempts to expose a child’s identity or location. Establish trained human review and escalation for high-risk reports. Preserve only the evidence needed for a lawful safety response, restrict access, and follow mandatory reporting and law-enforcement request rules applicable to the operating countries.

Give users a persistent reporting route on profiles, posts, videos, stories, groups, and messages. Let a reporter identify the concern, add context, and receive a case reference and status. Provide urgent escalation guidance for imminent danger. Explain blocking and evidence-saving options without encouraging users to redistribute harmful material.

## 5. Intimate imagery and urgent removal

Create a clear, accessible reporting flow for non-consensual intimate imagery, including imagery of a person who was under 18 when depicted. Restrict access to reports, prevent onward sharing, and promptly review the content. For platforms and material covered by the US TAKE IT DOWN Act, implement a valid notice process and the statutory removal and known-identical-copy response deadlines. The FTC states that the Act’s covered platform obligations took effect on May 19, 2026. Do not promise removal timelines beyond what the applicable law and staffed service can meet. [FTC TAKE IT DOWN Act guidance](https://www.ftc.gov/business-guidance/resources/complying-take-it-down-act)

## 6. Guardian involvement and privacy

Where parental consent is legally required, provide a secure guardian verification route, a clear explanation of the information involved, and a way to withdraw consent and request deletion where required. Collect only the guardian information needed to verify and manage consent. Keep a record of the method, scope, date, and withdrawal status. Do not give guardians unrestricted access to a young person’s private messages unless a lawful, disclosed feature and a child-safety assessment support it.

## 7. Review, appeals, and accountability

Give users a route to challenge account restrictions and content decisions, with age-appropriate explanations and access to a human review for significant decisions. Keep access to safety case files restricted and logged. Audit age-screen completion, report response times, appeal outcomes, false positives, and safety incidents. Review the child impact assessment whenever a new feature changes discovery, messaging, sharing, recommendations, location use, or public visibility.

## 8. Prototype limits and launch checklist

The browser preview displays a precautionary under-18 pathway. The optional local API blocks account registration for everyone under 18 until a verified guardian pathway exists, but it does not independently verify age or provide that guardian process. The project has no production SMS delivery, reporting inbox, moderation team, complete privacy enforcement across all features, or emergency escalation. Do not use it to process real children’s data or publish it as a functioning child-safety program.

Before launch, complete a market-by-market legal assessment; appoint accountable safety and privacy owners; implement tested report intake and escalation; verify the guardian workflow; integrate server-side privacy controls; document providers and retention; train moderators; and test appeal and incident handling.
