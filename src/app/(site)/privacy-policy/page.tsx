import type { Metadata } from 'next'

/**
 * ⭐ /privacy-policy — MARTIS iOS UYGULAMASI GİZLİLİK POLİTİKASI
 *
 * ⚠️⚠️ BU SAYFA `(legal)` GRUBUNA KOYULMAZ. Oradaki düzen her metnin
 * başına "Taslak metin — hukuk danışmanı tarafından güncellenecek"
 * rozetini basar ve `robots: { index: false }` uygular. İkisi de burada
 * FELAKETTİR: App Store incelemesi bu adresi açar, taslak rozeti gören
 * inceleyici uygulamayı reddeder; indekslenmeyen bir adres ise Apple'ın
 * istediği "publicly accessible" şartını zayıflatır.
 *
 * ⚠️ METİNDEKİ HER ÜÇÜNCÜ TARAF GERÇEKTEN KULLANILIYOR. Liste operatöre
 * tek tek soruldu (Firebase Authentication, Firebase Analytics &
 * Crashlytics, OpenAI API, kendi backend'imiz). Kullanılmayan bir servisi
 * "ihtimale karşı" yazmak GDPR'da yanlış beyandır; kullanılan birini
 * yazmamak ise eksik beyandır. Yeni bir SDK eklendiğinde BURASI DA
 * güncellenir.
 *
 * ⚠️ UYDURMA İLETİŞİM BİLGİSİ YOK. Projede yalnızca `destek@medya333.com`
 * gerçek ve çalışıyor; açık adres ile telefon numarası bilinmediği için
 * metne KONULMADI. `tests/unit/privacy-policy.test.ts` uydurma adres ve
 * telefon girmesini engelliyor.
 *
 * ⚠️ HESAP SİLME — APPLE ŞARTI. Apple, hesap açabilen uygulamalarda hesabın
 * UYGULAMA İÇİNDEN de silinebilmesini zorunlu tutar. Metin e-posta yolunu
 * taahhüt ediyor; uygulamaya "Delete Account" ekranı eklendiğinde aşağıdaki
 * "How to delete" bölümüne o yol da yazılmalıdır.
 */

const LAST_UPDATED = '15 September 2026'
const CONTACT_EMAIL = 'destek@medya333.com'

export const metadata: Metadata = {
  title: 'Privacy Policy — Martis',
  description:
    'How Medya 333 collects, uses, stores and deletes personal data in the Martis iOS app, '
    + 'including chat history, Firebase services and AI processing.',
  alternates: { canonical: '/privacy-policy' },
  // ⚠️ Diğer yasal sayfaların aksine BU SAYFA İNDEKSLENİR — bkz. dosya başı.
  robots: { index: true, follow: true },
  openGraph: {
    type: 'article',
    locale: 'en_US',
    url: '/privacy-policy',
    title: 'Privacy Policy — Martis',
    description: 'How Medya 333 handles personal data in the Martis iOS app.',
  },
}

/** Sayfa içi gezinme — mobilde de tek sütun hâlinde okunur kalır. */
const SECTIONS = [
  { id: 'who-we-are', label: 'Who we are' },
  { id: 'data-we-collect', label: 'Data we collect' },
  { id: 'how-we-use-data', label: 'How we use your data' },
  { id: 'legal-bases', label: 'Legal bases (GDPR)' },
  { id: 'third-parties', label: 'Third-party services' },
  { id: 'transfers', label: 'International transfers' },
  { id: 'retention', label: 'How long we keep data' },
  { id: 'deletion', label: 'Deleting your data' },
  { id: 'your-rights', label: 'Your rights' },
  { id: 'security', label: 'Security' },
  { id: 'children', label: "Children's privacy" },
  { id: 'changes', label: 'Changes to this policy' },
  { id: 'contact', label: 'Contact us' },
] as const

/**
 * ⚠️⚠️ BU LİSTE BEYANIN KENDİSİDİR — dekor değil.
 * Buradaki her kayıt operatöre tek tek soruldu. Uygulamaya yeni bir SDK
 * eklendiğinde buraya da eklenmezse beyan EKSİK olur; kullanılmayan biri
 * yazılırsa YANLIŞ olur. `tests/unit/privacy-policy.test.ts` ikisini de
 * kontrol ediyor.
 */
const PROVIDERS = [
  {
    name: 'Firebase Authentication',
    entity: 'Google Ireland Ltd. / Google LLC',
    purpose: 'Creates and verifies your account, and keeps you signed in.',
    data: 'Email address, hashed password, user ID, sign-in metadata.',
  },
  {
    name: 'Firebase Analytics & Crashlytics',
    entity: 'Google Ireland Ltd. / Google LLC',
    purpose: 'Usage statistics and crash reporting.',
    data: 'Pseudonymous app instance identifier, device and app information, crash logs.',
  },
  {
    name: 'OpenAI API',
    entity: 'OpenAI, L.L.C.',
    purpose: 'Generates the answers to the questions you send.',
    data: 'The text of your question and the relevant conversation context.',
  },
  {
    name: 'Medya 333 backend API',
    entity: 'Operated by us',
    purpose: 'Stores your account record and chat history, and routes requests to the AI provider.',
    data: 'All of the data described in section 2.',
  },
] as const

export default function PrivacyPolicyPage() {
  return (
    /**
     * ⚠️ `lang="en"` GEREKLİ. Kök düzen `lang="tr-TR"` veriyor; bu sayfa
     * İngilizce. Belirtilmezse ekran okuyucu İngilizce metni Türkçe
     * sesletimle okur ve arama motoru sayfayı yanlış dilde sınıflandırır.
     */
    <article lang="en" className="mx-auto max-w-3xl px-5 py-14">
      <header>
        <p className="text-caption font-semibold uppercase tracking-wider text-brand-600">
          Martis for iOS
        </p>
        <h1 className="mt-2 text-h1 text-ink-900">Privacy Policy</h1>
        <p className="mt-3 text-small text-ink-500">
          Last updated: {LAST_UPDATED} · Effective: {LAST_UPDATED}
        </p>
        <p className="mt-5 text-body leading-relaxed text-ink-600">
          This Privacy Policy explains how <strong className="text-ink-900">Medya 333</strong>{' '}
          (&ldquo;we&rdquo;, &ldquo;us&rdquo;) collects, uses, stores and deletes personal data
          when you use <strong className="text-ink-900">Martis</strong>, our iOS application in
          which you create an account, send questions and receive answers generated by artificial
          intelligence.
        </p>
        <p className="mt-3 text-body leading-relaxed text-ink-600">
          It applies only to the Martis app. Other Medya 333 products and this website are covered
          by their own notices.
        </p>
      </header>

      {/* --- İçindekiler ---------------------------------------------- */}
      <nav
        aria-label="Sections of this policy"
        className="mt-10 rounded-[--radius-card] border border-ink-200 bg-white p-6 shadow-[--shadow-card]"
      >
        <h2 className="text-caption font-semibold uppercase tracking-wider text-ink-500">
          On this page
        </h2>
        <ol className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {SECTIONS.map((s, i) => (
            <li key={s.id} className="text-small">
              <a
                href={`#${s.id}`}
                className="text-ink-600 underline-offset-2 transition-colors duration-[--duration-fast] hover:text-brand-600 hover:underline"
              >
                <span className="tabular text-ink-400">{String(i + 1).padStart(2, '0')}</span>{' '}
                {s.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-12 flex flex-col gap-10">
        <Section id="who-we-are" title="1. Who we are">
          <P>
            Martis is operated by <strong className="text-ink-900">Medya 333</strong>. For the
            purposes of the EU and UK General Data Protection Regulation (GDPR), Medya 333 is the{' '}
            <em>data controller</em> for the personal data described in this policy.
          </P>
          <P>
            You can reach us about any privacy matter at{' '}
            <MailLink /> . We answer privacy requests from this address and no other.
          </P>
        </Section>

        <Section id="data-we-collect" title="2. Data we collect">
          <P>We collect only what the app needs in order to work. Specifically:</P>

          <SubHeading>Account data</SubHeading>
          <List
            items={[
              <>
                <strong className="text-ink-900">Email address</strong> and, where you choose to
                set one, a display name. These are used to create your account and to sign you back
                in.
              </>,
              <>
                <strong className="text-ink-900">Authentication identifiers</strong> — a unique
                user ID issued by Firebase Authentication, together with sign-in metadata such as
                the time of your last sign-in and the sign-in method used.
              </>,
              <>
                <strong className="text-ink-900">Password</strong> — if you sign in with an email
                and password, the password is handled and stored by Firebase Authentication in
                hashed form. We never see or store your password ourselves.
              </>,
            ]}
          />

          <SubHeading>Chat content</SubHeading>
          <List
            items={[
              <>
                <strong className="text-ink-900">The questions and messages you send</strong>, and
                the AI-generated answers you receive. These are transmitted to our backend servers
                and stored there so that your conversation history is available to you across
                sessions and devices.
              </>,
              <>
                <strong className="text-ink-900">Conversation metadata</strong> — timestamps,
                message ordering and the conversation a message belongs to.
              </>,
            ]}
          />
          <Callout>
            Please do not send information you would not want stored. Because chat history is saved
            on our servers, avoid including passwords, payment card numbers, government
            identification numbers or health information in your messages.
          </Callout>

          <SubHeading>Technical and usage data</SubHeading>
          <List
            items={[
              <>
                <strong className="text-ink-900">Device and app information</strong> — device
                model, operating system version, app version, language and region, collected
                through Firebase.
              </>,
              <>
                <strong className="text-ink-900">Usage events</strong> — pseudonymous events such
                as app opens and screen views, collected through Firebase Analytics to help us
                understand which parts of the app are used.
              </>,
              <>
                <strong className="text-ink-900">Crash and diagnostic reports</strong> — collected
                through Firebase Crashlytics when the app stops unexpectedly, including the state
                of the app at the moment of the crash.
              </>,
              <>
                <strong className="text-ink-900">IP address</strong>, processed by our backend and
                by our service providers as part of delivering and securing the service.
              </>,
            ]}
          />

          <SubHeading>What we do not collect</SubHeading>
          <List
            items={[
              <>We do not collect your contacts, photos, precise location or health data.</>,
              <>
                We do not use your data for advertising, and we do not sell or rent personal data
                to anyone.
              </>,
              <>
                Martis does not process payments, so we do not receive or store payment card
                details. Any purchase made through the App Store is handled by Apple under{' '}
                <ExternalLink href="https://www.apple.com/legal/privacy/">
                  Apple&rsquo;s privacy policy
                </ExternalLink>
                .
              </>,
            ]}
          />
        </Section>

        <Section id="how-we-use-data" title="3. How we use your data">
          <List
            items={[
              <>
                <strong className="text-ink-900">To provide the service</strong> — creating and
                authenticating your account, sending your question to the AI provider, returning
                the answer, and saving your conversation so you can come back to it.
              </>,
              <>
                <strong className="text-ink-900">To keep the service working and safe</strong> —
                diagnosing crashes, detecting abuse, rate-limiting and preventing fraudulent or
                automated use.
              </>,
              <>
                <strong className="text-ink-900">To improve the app</strong> — understanding, in
                aggregate, which features are used and where people get stuck.
              </>,
              <>
                <strong className="text-ink-900">To communicate with you</strong> — replying to
                your support or privacy requests, and sending service messages such as password
                resets.
              </>,
              <>
                <strong className="text-ink-900">To meet legal obligations</strong> — where we are
                required to retain or disclose information by law.
              </>,
            ]}
          />
          <P>
            We do not use your chat content to build advertising profiles, and we do not use it to
            train our own models.
          </P>
        </Section>

        <Section id="legal-bases" title="4. Legal bases for processing (GDPR)">
          <P>
            If you are in the European Economic Area or the United Kingdom, we rely on the
            following legal bases under Article 6 GDPR:
          </P>
          <List
            items={[
              <>
                <strong className="text-ink-900">Performance of a contract</strong> (Art. 6(1)(b))
                — for account creation, authentication, processing your questions and storing your
                chat history. Without this data the app cannot function.
              </>,
              <>
                <strong className="text-ink-900">Legitimate interests</strong> (Art. 6(1)(f)) — for
                security, abuse prevention, crash diagnostics and keeping the service reliable. Our
                interest is in operating a functioning, secure service; we balance it against your
                rights and limit the data to what is necessary.
              </>,
              <>
                <strong className="text-ink-900">Consent</strong> (Art. 6(1)(a)) — for analytics
                where consent is required in your jurisdiction. You can withdraw consent at any
                time; withdrawal does not affect processing that already took place.
              </>,
              <>
                <strong className="text-ink-900">Legal obligation</strong> (Art. 6(1)(c)) — where
                retention or disclosure is required by applicable law.
              </>,
            ]}
          />
        </Section>

        <Section id="third-parties" title="5. Third-party services we use">
          <P>
            We use the providers below. Each one processes data on our behalf under a data
            processing agreement, and only for the purpose described.
          </P>

          {/**
            * ⚠️ TABLO DEĞİL, KART LİSTESİ — BİLİNÇLİ TERCİH.
            * Üç sütunlu bir tablo 390px'te yatay kaydırma gerektiriyordu:
            * ölçtüğümüzde "Data involved" sütunu ekranın tamamen dışında
            * kalıyordu. Yasal bir metinde okuyucunun varlığını fark bile
            * etmediği bir sütun, yazılmamış sayılır. Kart düzeni her
            * genişlikte üç bilgiyi de görünür tutar.
            */}
          <ul className="flex flex-col gap-3">
            {PROVIDERS.map((p) => (
              <li
                key={p.name}
                className="rounded-[--radius-card] border border-ink-200 bg-white p-5 shadow-[--shadow-card]"
              >
                <p className="text-body font-semibold text-ink-900">{p.name}</p>
                <p className="mt-0.5 text-caption text-ink-400">{p.entity}</p>
                <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Field label="What it does">{p.purpose}</Field>
                  <Field label="Data involved">{p.data}</Field>
                </dl>
              </li>
            ))}
          </ul>

          <P>
            OpenAI states that data submitted through its API is not used to train its models.
            Google processes Firebase data in accordance with its own terms. You can read their
            notices here:{' '}
            <ExternalLink href="https://openai.com/policies/privacy-policy/">
              OpenAI Privacy Policy
            </ExternalLink>{' '}
            ·{' '}
            <ExternalLink href="https://firebase.google.com/support/privacy">
              Firebase Privacy and Security
            </ExternalLink>
            .
          </P>
          <P>
            We may also disclose data where we are legally required to do so, or where it is
            necessary to establish, exercise or defend legal claims.
          </P>
        </Section>

        <Section id="transfers" title="6. International data transfers">
          <P>
            Our providers process data on servers located outside your country, including in the
            United States. Where personal data is transferred out of the European Economic Area or
            the United Kingdom, the transfer takes place on the basis of the European
            Commission&rsquo;s Standard Contractual Clauses (and the UK International Data Transfer
            Addendum where applicable), together with the additional safeguards those providers
            apply.
          </P>
        </Section>

        <Section id="retention" title="7. How long we keep your data">
          <List
            items={[
              <>
                <strong className="text-ink-900">Account data</strong> — kept for as long as your
                account exists.
              </>,
              <>
                <strong className="text-ink-900">Chat messages and history</strong> — kept until
                you delete them or delete your account.
              </>,
              <>
                <strong className="text-ink-900">Crash reports</strong> — retained by Crashlytics
                for up to 90 days.
              </>,
              <>
                <strong className="text-ink-900">Analytics events</strong> — retained in
                pseudonymous, aggregated form according to our Firebase retention settings.
              </>,
              <>
                <strong className="text-ink-900">Backups</strong> — deleted data may persist in
                encrypted backups for up to 90 days before those backups expire.
              </>,
            ]}
          />
        </Section>

        <Section id="deletion" title="8. Deleting your data">
          <P>
            You can have your account and everything associated with it deleted. Email{' '}
            <MailLink /> from the address registered to your Martis account and tell us what you
            want deleted — your whole account, or specific conversations.
          </P>
          <List
            items={[
              <>We acknowledge the request within 72 hours.</>,
              <>
                We delete the data from our live systems{' '}
                <strong className="text-ink-900">within 30 days</strong>, and confirm to you in
                writing once it is done.
              </>,
              <>
                Copies in encrypted backups expire within a further 90 days, after which no copy
                remains.
              </>,
              <>
                Deleting your account removes your account record, your chat messages and your
                conversation history. It cannot be undone.
              </>,
            ]}
          />
          <P>
            Individual conversations can also be deleted from within the app at any time, without
            deleting your account.
          </P>
        </Section>

        <Section id="your-rights" title="9. Your rights">
          <P>
            Under the GDPR — and under comparable laws elsewhere, including Türkiye&rsquo;s Law
            No. 6698 (KVKK) — you have the right to:
          </P>
          <List
            items={[
              <>
                <strong className="text-ink-900">Access</strong> the personal data we hold about
                you, and receive a copy of it.
              </>,
              <>
                <strong className="text-ink-900">Rectify</strong> data that is inaccurate or
                incomplete.
              </>,
              <>
                <strong className="text-ink-900">Erase</strong> your data (see section 8).
              </>,
              <>
                <strong className="text-ink-900">Restrict</strong> or{' '}
                <strong className="text-ink-900">object to</strong> processing carried out on the
                basis of our legitimate interests.
              </>,
              <>
                <strong className="text-ink-900">Data portability</strong> — receive your data in a
                structured, commonly used, machine-readable format.
              </>,
              <>
                <strong className="text-ink-900">Withdraw consent</strong> at any time, where
                processing is based on consent.
              </>,
              <>
                <strong className="text-ink-900">Lodge a complaint</strong> with your local data
                protection authority.
              </>,
            ]}
          />
          <P>
            To exercise any of these rights, write to <MailLink /> . We respond within 30 days. We
            do not charge for this, and we will not treat you differently for asking.
          </P>
        </Section>

        <Section id="security" title="10. How we protect your data">
          <List
            items={[
              <>All traffic between the app, our backend and our providers is encrypted in transit (TLS).</>,
              <>Data at rest is encrypted by our infrastructure providers.</>,
              <>
                Authentication is handled by Firebase Authentication; we never store passwords in
                readable form.
              </>,
              <>Access to production systems is limited to the people who need it to operate the service.</>,
            ]}
          />
          <P>
            No system is perfectly secure. If a data breach occurs that is likely to present a risk
            to your rights, we will notify the competent supervisory authority within 72 hours and
            inform you without undue delay where the law requires it.
          </P>
        </Section>

        <Section id="children" title="11. Children's privacy">
          <P>
            Martis is not directed at children. We do not knowingly collect personal data from
            anyone under the age of 16. If you believe a child has provided us with personal data,
            contact <MailLink /> and we will delete it.
          </P>
        </Section>

        <Section id="changes" title="12. Changes to this policy">
          <P>
            We may update this policy as the app changes. The date at the top of this page always
            shows the current version. If a change materially affects how we handle your data, we
            will tell you in the app or by email before it takes effect.
          </P>
        </Section>

        <Section id="contact" title="13. Contact us">
          <P>
            For any question about this policy, to exercise your rights, or to request deletion of
            your data:
          </P>
          <div className="rounded-[--radius-card] border border-ink-200 bg-white p-6 shadow-[--shadow-card]">
            <p className="text-caption font-semibold uppercase tracking-wider text-ink-500">
              Data controller
            </p>
            <p className="mt-2 text-body font-semibold text-ink-900">Medya 333</p>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="mt-1 inline-block text-body text-brand-600 underline underline-offset-2"
            >
              {CONTACT_EMAIL}
            </a>
            <p className="mt-4 text-small leading-relaxed text-ink-600">
              Please write from the email address registered to your Martis account so we can
              verify the request. We reply to every privacy request, including to confirm when a
              deletion has been completed.
            </p>
          </div>
        </Section>
      </div>
    </article>
  )
}

// ===========================================================================
// Sunum yardımcıları — metin uzun, kalıplar tekrar ediyor.
// ===========================================================================

function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    /**
     * ⚠️ `scroll-mt-*` ŞART: içindekiler bağlantıları çıpaya atlıyor ve
     * sayfanın üstünde yapışkan başlık var; pay verilmezse başlık, atlanan
     * bölümün kendi başlığını örter ve kullanıcı yanlış yere geldiğini
     * sanır.
     */
    <section id={id} className="scroll-mt-24">
      <h2 className="text-h2 text-ink-900">{title}</h2>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  )
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-2 text-h3 text-ink-900">{children}</h3>
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-body leading-relaxed text-ink-600">{children}</p>
}

function List({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5 text-body leading-relaxed text-ink-600 marker:text-brand-500">
      {items.map((item, i) => (
        // eslint-disable-next-line react/no-array-index-key -- sabit, sıralaması değişmeyen liste
        <li key={i}>{item}</li>
      ))}
    </ul>
  )
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-[--radius-card] border border-warning-600/25 bg-warning-100/60 p-5 text-small leading-relaxed text-ink-700">
      {children}
    </p>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-caption font-semibold uppercase tracking-wider text-ink-500">{label}</dt>
      <dd className="mt-1 text-small leading-relaxed text-ink-600">{children}</dd>
    </div>
  )
}

function MailLink() {
  return (
    <a
      href={`mailto:${CONTACT_EMAIL}`}
      className="text-brand-600 underline underline-offset-2 transition-colors duration-[--duration-fast] hover:text-brand-700"
    >
      {CONTACT_EMAIL}
    </a>
  )
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    /**
     * ⚠️ `rel="noreferrer"` — yeni sekmede açılan dış bağlantı, hedefe
     * hangi sayfadan gelindiğini söylemesin diye. `noopener` ise açılan
     * sayfanın `window.opener` üzerinden bu sekmeyi yönlendirmesini keser.
     */
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-brand-600 underline underline-offset-2 transition-colors duration-[--duration-fast] hover:text-brand-700"
    >
      {children}
    </a>
  )
}
