/* Language switching for the voucher site.
 *
 * One file holds the engine and every string, so a wording change happens in
 * one place rather than five. Pages mark text with data-i18n="key"; anything
 * built in JavaScript asks for t('key') instead.
 *
 * The language is the visitor's own browser setting unless they have said
 * otherwise, which they say by pressing HU or EN. That choice is remembered.
 * The backoffice is deliberately left out: it is staff-only and English.
 */
(function (global) {
  'use strict';

  var STORE = 'bpc-lang';

  var STRINGS = {
    en: {
      /* shared */
      'lang.hu': 'HU',
      'lang.en': 'EN',
      'lang.switch': 'Change language',
      'foot.site': 'BalatonPark.com',
      'foot.terms': 'Terms',
      'foot.faq': 'FAQ',
      'buy.faqLink': 'Questions? Read the FAQ',
      'faq.title': 'Questions - Balaton Park Circuit gift vouchers',
      'faq.eyebrow': 'Gift vouchers',
      'faq.h1': 'Questions.',
      'faq.lede': 'Everything worth knowing before you buy, and everything the person you give it to will want to know.',
      'faq.cta': 'Buy a voucher',
      'faq.ask': 'Something not answered here? {contact} and we will come back to you.',

      'faq.how.q': 'How does a gift voucher work?',
      'faq.how.a': 'You buy the voucher and choose how it is delivered. The person you give it to opens it, enters the code and picks the track day they want. We then hand them the booking code for that day. You never have to pick a date for them.',
      'faq.dates.q': 'Which days can it be used on?',
      'faq.dates.a': 'Any published Balaton Park Circuit track day in the 2027 season, while places last. The first three are 17 April, 22 May and 26 June 2027, all Saturdays, and more will be announced.',
      'faq.book.q': 'When can the recipient actually book?',
      'faq.book.a': 'Registration for the 2027 season opens in January 2027. The voucher can be bought and given at any time before that - we announce the opening on our socials and in the newsletter at balatonpark.com.',
      'faq.split.q': 'Can the sessions be used on different days?',
      'faq.split.a': 'Yes, for the session packages. Three or six sessions can all be taken on one track day, or spread across different days, and every day redeemed gets its own booking code. The VIP day is a single day and is not split.',
      'faq.length.q': 'How long is a session?',
      'faq.length.a': 'A regular track session is 25 minutes. On the VIP day the sessions are 30 minutes.',
      'faq.vip.q': 'What is in the VIP day?',
      'faq.vip.a': 'At least five 30-minute sessions, a box garage for the day, dedicated care on site and a direct contact to call on. It is bought and used as one full day.',
      'faq.hotel.q': 'What does the night at the hotel include?',
      'faq.hotel.a': 'Everything in the VIP day, plus one night at Balaton Park Hotel on the circuit.',
      'faq.delivery.q': 'How is the voucher delivered?',
      'faq.delivery.a': 'Three ways, your choice at checkout: emailed to the recipient straight away, emailed on a date you set, or shown to you now so you can print it or hand it over yourself.',
      'faq.lost.q': 'What if the code gets lost?',
      'faq.lost.a': 'There is a lost-code link on the redeem page: enter the email the voucher was sent to and we send the code again. If that does not help, {contact}.',
      'faq.transfer.q': 'Can it be passed on to someone else?',
      'faq.transfer.a': 'The code is not tied to a name until it is redeemed, so whoever holds it can use it. Once it has been redeemed for a date, the booking that comes out of it follows the circuit\'s usual rules - see the {terms}.',
      'faq.refund.q': 'Can I get a refund?',
      'faq.refund.a': 'Get in touch and we will look at it: {contact}. An unredeemed voucher is the simple case. Once a voucher has been redeemed for a date the booking is in the circuit\'s hands and the {terms} apply.',
      'faq.bring.q': 'What does the driver need on the day?',
      'faq.bring.a': 'The same as for any public session at the circuit: a valid licence and the required riding or driving gear. The {terms} spell out what is needed.',
      'faq.vat.q': 'Do the prices include VAT?',
      'faq.vat.a': 'Yes. Every price on the site is the final price, VAT included, and an invoice follows the purchase.',
      'faq.moved.q': 'What if a date is moved or cancelled?',
      'faq.moved.a': 'Dates can be moved or cancelled. If that happens to a day a voucher has been redeemed for, we sort out a new date with the holder. See the {terms}.',
      'foot.privacy': 'Privacy',
      'foot.contact': 'Contact us',
      'common.emailUs': 'email us',
      'common.terms': 'terms',
      'common.sessionOne': 'session',
      'common.sessionMany': 'sessions',
      'common.saturday': 'Saturday',
      'common.copy': 'Copy code',
      'common.copied': 'Copied',
      'common.copyManual': 'Select it manually',
      'common.loading': 'Loading…',

      /* landing */
      'home.title': 'Balaton Park Circuit - Gift Vouchers',
      'home.eyebrow': 'Gift vouchers',
      'home.h1a': 'Gift your loved ones a day on track.',
      'home.h1b': 'Maybe even a night.',
      'home.lede': 'Buy a voucher for track sessions at Balaton Park Circuit. The person you give it to picks their own date - no need to decide for them.',
      'home.buy': 'Buy a voucher',
      'home.redeem': 'Redeem a voucher',
      'home.scroll': 'Scroll',
      'home.howA': 'How it',
      'home.howB': 'works.',
      'home.step1h': 'You buy',
      'home.step1p': 'Pick a package. We email a beautiful gift card with voucher code or you print a physical one.',
      'home.step2h': 'They choose a date',
      'home.step2p': 'They enter the code here and pick from our published track days.',
      'home.step3h': 'They book',
      'home.step3p': 'We assist them with booking their desired date & time.',
      'home.daysA': 'Track days',
      'home.daysB': '2027.',
      'home.soon': 'More to come soon!',
      'home.note': 'Vouchers are valid for the 2027 season and can be redeemed against any published 2027 track day while places last. Riding gear and licence requirements are the same as any public session. Dates may be moved or cancelled - see the {terms}. For refund requests, {email}.',
      'cookie.text': 'Essential cookies keep the voucher system working! Other ones are important to us.',
      'cookie.more': 'More',
      'cookie.essentials': 'Essentials',
      'cookie.accept': 'Accept',

      /* purchase */
      'buy.title': 'Buy a gift voucher - Balaton Park Circuit',
      'buy.eyebrow': 'Step 1 of 2 · Choose & pay',
      'buy.h1a': 'Gift a session.',
      'buy.h1b': 'Or more.',
      'buy.lede': 'Pick one package or several - they add up in the summary. The recipient picks their own track day later.',
      'buy.sec1': '1 · Packages',
      'buy.sec2': '2 · Who is it for',
      'buy.sec3': '3 · Delivery',
      'buy.sec4': '4 · Your details',
      'buy.kindSession': 'session',
      'buy.kindSessions': 'sessions',
      'buy.kindDay': 'full day',
      'buy.whatsThis': "What's included",
      'pkg.s1.title': 'One session',
      'pkg.s1.body': 'One 25-minute track session. The voucher is a single code, redeemed for one track day of the recipient\'s choice.',
      'pkg.s3.title': 'Three sessions',
      'pkg.s3.body': 'Three 25-minute track sessions on one voucher. They can all be used on a single track day, or spread across different days - every day redeemed gets its own code.',
      'pkg.s6.title': 'Six sessions',
      'pkg.s6.body': 'Six 25-minute track sessions on one voucher. They can all be used on a single track day, or spread across different days - every day redeemed gets its own code.',
      'pkg.vip.title': 'VIP day',
      'pkg.vip.body': 'A full day at the circuit: at least five 30-minute sessions, a box garage, dedicated care on site and a direct contact. One voucher for one day, not split across dates.',
      'pkg.vipstay.title': 'VIP day + one night',
      'pkg.vipstay.body': 'Everything in the VIP day, plus one night at Balaton Park Hotel. One voucher for one day, not split across dates.',
      'buy.off': '{pct}% off',
      'buy.stayNight': 'Stay the night',
      'buy.hotelName': 'VIP Day + 1 night<br>at Balaton Park Hotel',
      'buy.hotelBlurb': 'The full VIP track day, then a room looking straight down the main straight. Double room with breakfast for one - breakfast for a second guest is extra.',
      'buy.smallprint': 'A session is 25 minutes of track time. The VIP Day is at least five 30-minute sessions, your own box garage, dedicated care on site and a direct contact for the whole day. Rooms and photos at {hotel}.',
      'buy.rname': 'Recipient name',
      'buy.remail': 'Recipient email',
      'buy.msg': 'Message on the gift card',
      'buy.msgPlaceholder': 'Happy birthday! See you on track.',
      'buy.delNow': 'Email it now',
      'buy.delNowSub': 'Sent straight to the recipient after payment.',
      'buy.delDate': 'Email it on a date',
      'buy.delDateSub': 'Pick the day and time it should land.',
      'buy.delPrint': 'Print it yourself',
      'buy.delPrintSub': 'Download a PDF gift card after payment. We keep the recipient’s email on file but send them nothing.',
      'buy.sendOn': 'Send on',
      'buy.sendAt': 'At',
      'buy.sendNote': 'Budapest time. Nothing is sent until then - you’ll get your own copy straight after payment, so you know it worked.',
      'buy.bname': 'Your name',
      'buy.bemail': 'Your email',
      'buy.summary': 'Summary',
      'buy.empty': 'Nothing picked yet. Choose one or more packages above.',
      'buy.each': '{amount} each',
      'buy.save': 'You save',
      'buy.total': 'Total',
      'buy.pay': 'Pay with card',
      'buy.payAmount': 'Pay {amount}',
      'buy.paying': 'Paying…',
      'buy.nudge': 'Add {n} more {sessions} for <strong>{pct}%</strong> off everything',
      'buy.noCard': 'We never see your card details.',
      'buy.codeOne': 'Your code is issued the moment payment clears.',
      'buy.codeMany': 'You get {n} separate voucher codes, one per voucher.',
      'buy.refund': 'For refund requests, {email}.',
      'buy.haveVoucher': 'Already have a voucher? {link}.',
      'buy.redeemHere': 'Redeem it here',
      'buy.mayChange': 'Dates may be moved or cancelled - see the {terms}.',
      'buy.errPackage': 'Choose at least one package.',
      'buy.errRecipient': 'We need a valid email for the person receiving the gift.',
      'buy.errBuyer': 'We need your email, so we can send you the receipt.',
      'buy.errDate': 'Pick the day the gift should arrive.',
      'buy.errPast': 'That send date is in the past.',
      'buy.errNoPay': 'Card payments are not switched on yet. Please try again shortly.',
      'buy.errStart': 'We could not start the payment. Nothing has been charged.',
      'buy.errNet': 'Could not reach the server. Check your connection and try again - nothing has been charged.',
      'buy.errCard': 'That payment did not go through. Nothing has been charged - try again or use another card.',
      'buy.errLoad': 'Could not load the packages. Please refresh, or {email}.',

      /* redeem */
      'red.title': 'Redeem a gift voucher - Balaton Park Circuit',
      'red.step1': 'Step 1 of 2 · Your code',
      'red.h1': 'Redeem your voucher.',
      'red.lede': 'Enter the code from your gift card. You’ll choose your track days next.',
      'red.codeLabel': 'Voucher code',
      'red.continue': 'Continue',
      'red.checking': 'Checking…',
      'red.lost': 'Lost the code? {email} with the buyer’s name and we’ll find it.',
      'red.emailUs': 'Email us',
      'red.tooShort': 'That code looks too short. It’s twelve characters, like BPC-ABCD-1234.',
      'red.step2': 'Step 2 of 2 · {left} of {total} left',
      'red.h2fresh': 'Pick a day and how many.',
      'red.h2more': 'Spend the rest when you like.',
      'red.leftOne': '{n} session left',
      'red.leftMany': '{n} sessions left',
      'red.different': 'Use a different code',
      'red.already': 'Codes you already have',
      'red.introFresh': 'Your {n} sessions can all run on one day, or be spread across different days.',
      'red.introMore': 'Spend as many of the rest as you like on this day - or come back another time for the others.',
      'red.notice': 'Registration for the 2027 track days opens on Cooltix in January 2027. Redeem now and your code is held for you. We’ll announce the opening on our socials and in the newsletter - {subscribe}. Sessions are 25 minutes.',
      'red.subscribe': 'subscribe here',
      'red.whichDay': '1 · Which day',
      'red.howMany': '2 · How many sessions',
      'red.howManyOn': '2 · How many sessions on {day}',
      'red.hint': 'You have {n} left. Each group you pick becomes its own Cooltix code for that day.',
      'red.hintPickDay': 'Choose a day first.',
      'red.alreadyHere': '{n} already here',
      'red.all': 'All {n}',
      'red.getCode': 'Get my code',
      'red.getCodeFor': 'Get my code for {n} {sessions}',
      'red.issuing': 'Issuing your code…',
      'red.footAll': 'Choosing a date doesn’t book your place - you get a discount code to use on Cooltix.',
      'red.footSome': 'You’ll still have {n} {sessions} to spend, any time in the 2027 season.',
      'red.soon': 'More to come soon!',
      'red.issued': 'Voucher redeemed',
      'red.issuedH': 'Code issued.',
      'red.doneH': 'You’re all set.',
      'red.issuedLede': 'Your Cooltix discount code for <strong>{day}</strong> is below. Registration opens in January 2027 - the code is held for you until then.',
      'red.yourCode': 'Your Cooltix discount code',
      'red.validFor': 'Valid for',
      'red.validForV': '{day} only',
      'red.covers': 'Covers',
      'red.uses': 'Uses',
      'red.usesV': 'Single use',
      'red.stepsA': 'What happens',
      'red.stepsB': 'on Cooltix.',
      'red.cstep1': 'Paste the code into the discount field <strong>before you add anything</strong> to the basket.',
      'red.cstep2': 'Add your {n} {sessions} for {day} to the basket.',
      'red.cstep3': 'The sessions are listed as free. Finish the checkout to get your ticket.',
      'red.warn': 'The code only works for {day} and expires when that day’s sales close. If you need a different date, don’t use it - {email} and we’ll swap it.',
      'red.more': 'Redeem {n} more {sessions}',
      'red.back': 'Back to gift vouchers',
      'red.spent': 'Voucher fully redeemed',
      'red.spentH': 'All sessions used.',
      'red.spentLede': 'Every session on <strong>{code}</strong> has been redeemed. Here are the codes it produced - they still work.',
      'red.yourCodes': 'Your Cooltix codes',
      'red.needDate': 'Need a different date? {email} and we’ll swap it. · {buy}',
      'red.buyAnother': 'Buy another voucher',
      'red.errNotFound': 'We can’t find that code. Check it against your gift card - letters and numbers only, spaces don’t matter.',
      'red.errExpired': 'That voucher has expired. Email us and we’ll see what we can do.',
      'red.errVoid': 'That voucher can’t be redeemed - it may have been refunded. If that’s unexpected, email us.',
      'red.errRate': 'Too many tries. Wait a few minutes and have another go.',
      'red.errPool': 'That day has just run out of codes for this voucher type. Pick another date, or email us.',
      'red.errCombo': 'That combination isn’t available for this day. Try a different number of sessions.',
      'red.errCount': 'That doesn’t match what’s left on the voucher. Refresh and try again.',
      'red.errSplit': 'This voucher is redeemed in one go, on a single day.',
      'red.errServer': 'Something broke on our side, not yours. Try again in a moment.',
      'red.errNet': 'Could not reach the server. Check your connection and try again.',
      'red.errGeneric': 'Something went wrong. Try again, or email us.',

      /* thank you */
      'ty.title': 'Thank you - Balaton Park Circuit',
      'ty.eyebrow': 'Payment received',
      'ty.h1': 'Thank you.',
      'ty.h1one': 'Your voucher is ready.',
      'ty.h1many': 'Your vouchers are ready.',
      'ty.confirming': 'Confirming your payment…',
      'ty.slow': 'Your payment went through, but the voucher is taking longer than usual to appear. It will arrive by email shortly - nothing is lost.',
      'ty.noOrder': 'We could not tell which order this is. If you have just paid, check your inbox - your confirmation has the voucher code.',
      'ty.unreachable': 'We could not reach the server to confirm your order. Your payment is safe - check your inbox, or contact us with this page’s address.',
      'ty.problemEyebrow': 'Something went sideways',
      'ty.problemH': 'Hold on.',
      'ty.contactFix': '{contact} and we will sort it.',
      'ty.refundedEyebrow': 'Order refunded',
      'ty.refundedH': 'This order was refunded.',
      'ty.refundedBody': 'The voucher from this order is no longer valid. If that is unexpected, {contact}.',
      'ty.nextPrint': 'Nothing has been sent to {name}. Print or hand over the {codes} below whenever you like.',
      'ty.nextSched': 'The gift goes to {email} on {date}. The {codes} below in the meantime - keep this page.',
      'ty.nextSent': 'We’ve emailed the gift to {recipient}, and a copy to you at {buyer}.',
      'ty.nextPending': 'Your voucher is below. We’ll send it to {recipient} shortly - save this page or the code in the meantime.',
      'ty.codeOne': 'code is',
      'ty.codeMany': 'codes are',
      'ty.voucherOf': '{name} · voucher {i} of {n}',
      'ty.covers': 'Covers',
      'ty.validUntil': 'Valid until',
      'ty.redeemAt': 'Redeem at',
      'ty.redeemNow': 'Redeem now',
      'ty.buyAnother': 'Buy another',
      'ty.paidOn': 'Paid {amount} on {date}. Keep this page or the email - the {codes} what gets redeemed. Lost it? {contact}.',

      /* 404 */
      'nf.title': 'Page not found - Balaton Park Circuit',
      'nf.h1': 'Wrong way round the circuit.',
      'nf.lede': 'That page isn’t here. The link may be old, or mistyped - nothing is broken on your end.',
      'nf.vouchers': 'Gift vouchers',
      'nf.redeem': 'Redeem a voucher',
      'nf.help': 'Looking for something specific? {contact} and we’ll point you at it.'
    },

    hu: {
      'lang.hu': 'HU',
      'lang.en': 'EN',
      'lang.switch': 'Nyelv váltása',
      'foot.site': 'BalatonPark.com',
      'foot.terms': 'ÁSZF',
      'foot.faq': 'GYIK',
      'buy.faqLink': 'Kérdésed van? Olvasd el a GYIK-et',
      'faq.title': 'Kérdések - Balaton Park Circuit ajándékutalványok',
      'faq.eyebrow': 'Ajándékutalványok',
      'faq.h1': 'Kérdések.',
      'faq.lede': 'Minden, amit vásárlás előtt tudni érdemes, és minden, amire a megajándékozott kíváncsi lesz.',
      'faq.cta': 'Utalvány vásárlása',
      'faq.ask': 'Nem találod itt a választ? {contact}, és visszajelzünk.',

      'faq.how.q': 'Hogyan működik az ajándékutalvány?',
      'faq.how.a': 'Megveszed az utalványt, és kiválasztod, hogyan kézbesítsük. A megajándékozott megnyitja, megadja a kódot, és kiválasztja a neki megfelelő pályanapot. Ezután megkapja az adott napra szóló foglalási kódot. Neked nem kell dátumot választanod helyette.',
      'faq.dates.q': 'Mely napokra váltható be?',
      'faq.dates.a': 'A 2027-es szezon bármelyik meghirdetett Balaton Park Circuit pályanapjára, amíg a helyek tartanak. Az első három: 2027. április 17., május 22. és június 26., mind szombat, és továbbiakat is meghirdetünk.',
      'faq.book.q': 'Mikortól tud ténylegesen foglalni?',
      'faq.book.a': 'A 2027-es szezon regisztrációja 2027 januárjában nyílik meg. Az utalvány bármikor megvásárolható és odaadható ezt megelőzően is - a nyitást a közösségi oldalainkon és a hírlevelünkben jelentjük be a balatonpark.com oldalon.',
      'faq.split.q': 'Felhasználhatók a szessziók különböző napokon?',
      'faq.split.a': 'A szessziócsomagoknál igen. A három vagy hat szesszió felhasználható egyetlen pályanapon, vagy elosztható több nap között, és minden beváltott napra külön foglalási kód jár. A VIP nap egyetlen nap, azt nem lehet szétosztani.',
      'faq.length.q': 'Mennyi ideig tart egy szesszió?',
      'faq.length.a': 'Egy normál pályaszesszió 25 perc. A VIP napon a szessziók 30 percesek.',
      'faq.vip.q': 'Mit tartalmaz a VIP nap?',
      'faq.vip.a': 'Legalább öt 30 perces szessziót, egy box garázst az adott napra, dedikált helyszíni segítséget és egy közvetlen kapcsolattartót. Egy teljes napként vásárolható és használható fel.',
      'faq.hotel.q': 'Mit tartalmaz a hotelben töltött éjszaka?',
      'faq.hotel.a': 'Mindent, ami a VIP napban, plusz egy éjszakát a pálya területén lévő Balaton Park Hotelben.',
      'faq.delivery.q': 'Hogyan kézbesítitek az utalványt?',
      'faq.delivery.a': 'Háromféleképpen, a pénztárnál te döntesz: azonnal e-mailben a megajándékozottnak, egy általad megadott napon e-mailben, vagy rögtön megmutatjuk neked, hogy kinyomtathasd vagy személyesen átadhasd.',
      'faq.lost.q': 'Mi van, ha elveszik a kód?',
      'faq.lost.a': 'A beváltó oldalon van egy elveszett kód link: add meg azt az e-mail-címet, amelyre az utalványt küldtük, és újraküldjük a kódot. Ha ez nem segít, {contact}.',
      'faq.transfer.q': 'Továbbadható másnak?',
      'faq.transfer.a': 'A kód a beváltásig nincs névhez kötve, így az használhatja fel, akinél van. A beváltás után a belőle létrejövő foglalásra a pálya szokásos szabályai vonatkoznak - lásd az {terms}.',
      'faq.refund.q': 'Kérhető visszatérítés?',
      'faq.refund.a': 'Vedd fel velünk a kapcsolatot, és megnézzük: {contact}. A be nem váltott utalvány az egyszerű eset. Ha az utalványt már beváltották egy dátumra, a foglalás a pálya hatáskörébe kerül, és az {terms} rendelkezései érvényesek.',
      'faq.bring.q': 'Mire van szüksége a vezetőnek az adott napon?',
      'faq.bring.a': 'Ugyanarra, mint a pálya bármely nyilvános szesszióján: érvényes jogosítványra és a előírt vezetői vagy motoros felszerelésre. Az {terms} részletezi, mi szükséges.',
      'faq.vat.q': 'Az árak tartalmazzák az áfát?',
      'faq.vat.a': 'Igen. Az oldalon minden ár végleges, áfával együtt értendő, és a vásárlásról számlát állítunk ki.',
      'faq.moved.q': 'Mi történik, ha egy időpont változik vagy elmarad?',
      'faq.moved.a': 'Az időpontok változhatnak vagy elmaradhatnak. Ha ez olyan napot érint, amelyre már beváltottak egy utalványt, új időpontot egyeztetünk a tulajdonossal. Lásd az {terms}.',
      'foot.privacy': 'Adatvédelem',
      'foot.contact': 'Kapcsolat',
      'common.emailUs': 'írj nekünk',
      'common.terms': 'feltételeket',
      'common.sessionOne': 'szesszió',
      'common.sessionMany': 'szesszió',
      'common.saturday': 'Szombat',
      'common.copy': 'Kód másolása',
      'common.copied': 'Másolva',
      'common.copyManual': 'Jelöld ki kézzel',
      'common.loading': 'Betöltés…',

      'home.title': 'Balaton Park Circuit - Ajándékutalványok',
      'home.eyebrow': 'Ajándékutalványok',
      'home.h1a': 'Ajándékozz egy napot a pályán.',
      'home.h1b': 'Vagy akár egy éjszakát is.',
      'home.lede': 'Vásárolj utalványt pályaszessziókra a Balaton Park Circuiten. Akinek ajándékozod, maga választja ki a dátumot - nem kell helyette döntened.',
      'home.buy': 'Utalvány vásárlása',
      'home.redeem': 'Utalvány beváltása',
      'home.scroll': 'Görgess',
      'home.howA': 'Így',
      'home.howB': 'működik.',
      'home.step1h': 'Te megveszed',
      'home.step1p': 'Válassz csomagot. E-mailben küldünk egy szép ajándékkártyát az utalványkóddal, vagy kinyomtatod magad.',
      'home.step2h': 'Ő választ dátumot',
      'home.step2p': 'Itt megadja a kódot, és választ a meghirdetett pályanapjaink közül.',
      'home.step3h': 'Ő lefoglalja',
      'home.step3p': 'Segítünk neki a kívánt időpont lefoglalásában.',
      'home.daysA': 'Pályanapok',
      'home.daysB': '2027.',
      'home.soon': 'Hamarosan továbbiak!',
      'home.note': 'Az utalványok a 2027-es szezonra érvényesek, és bármelyik meghirdetett 2027-es pályanapra beválthatók, amíg a helyek tartanak. A felszerelésre és az engedélyekre ugyanazok a feltételek vonatkoznak, mint bármelyik nyilvános szesszióra. Az időpontok változhatnak vagy elmaradhatnak - lásd a {terms}. Visszatérítési kérelemmel {email}.',
      'cookie.text': 'Az alapvető sütik tartják működésben az utalványrendszert! A többi fontos nekünk.',
      'cookie.more': 'Bővebben',
      'cookie.essentials': 'Csak alapvető',
      'cookie.accept': 'Elfogadom',

      'buy.title': 'Ajándékutalvány vásárlása - Balaton Park Circuit',
      'buy.eyebrow': '1. lépés a 2-ből · Választás és fizetés',
      'buy.h1a': 'Ajándékozz egy szessziót.',
      'buy.h1b': 'Vagy többet.',
      'buy.lede': 'Válassz egy csomagot vagy többet - az összesítőben összeadódnak. A pályanapot később a megajándékozott választja ki.',
      'buy.sec1': '1 · Csomagok',
      'buy.sec2': '2 · Kinek szól',
      'buy.sec3': '3 · Kézbesítés',
      'buy.sec4': '4 · A te adataid',
      'buy.kindSession': 'szesszió',
      'buy.kindSessions': 'szesszió',
      'buy.kindDay': 'teljes nap',
      'buy.whatsThis': 'Mit tartalmaz',
      'pkg.s1.title': 'Egy szesszió',
      'pkg.s1.body': 'Egy 25 perces pályaszesszió. Az utalvány egyetlen kód, amelyet a megajándékozott egy általa választott pályanapra vált be.',
      'pkg.s3.title': 'Három szesszió',
      'pkg.s3.body': 'Három 25 perces pályaszesszió egy utalványon. Mind felhasználható egyetlen pályanapon, vagy eloszthatók több nap között - minden beváltott napra külön kód jár.',
      'pkg.s6.title': 'Hat szesszió',
      'pkg.s6.body': 'Hat 25 perces pályaszesszió egy utalványon. Mind felhasználható egyetlen pályanapon, vagy eloszthatók több nap között - minden beváltott napra külön kód jár.',
      'pkg.vip.title': 'VIP nap',
      'pkg.vip.body': 'Egy teljes nap a pályán: legalább öt 30 perces szesszió, box garázs, dedikált helyszíni segítség és közvetlen kapcsolattartó. Egy utalvány egy napra, több nap között nem osztható szét.',
      'pkg.vipstay.title': 'VIP nap + egy éjszaka',
      'pkg.vipstay.body': 'Minden, ami a VIP napban, plusz egy éjszaka a Balaton Park Hotelben. Egy utalvány egy napra, több nap között nem osztható szét.',
      'buy.off': '{pct}% kedvezmény',
      'buy.stayNight': 'Maradj éjszakára',
      'buy.hotelName': 'VIP nap + 1 éjszaka<br>a Balaton Park Hotelben',
      'buy.hotelBlurb': 'A teljes VIP pályanap, utána egy szoba, ahonnan egyenesen a célegyenesre látsz. Kétágyas szoba reggelivel egy főre - a második vendég reggelije külön fizetendő.',
      'buy.smallprint': 'Egy szesszió 25 perc pályaidő. A VIP nap legalább öt 30 perces szesszió, saját boxgarázs, dedikált helyszíni ellátás és közvetlen kapcsolattartó egész napra. Szobák és képek: {hotel}.',
      'buy.rname': 'Megajándékozott neve',
      'buy.remail': 'Megajándékozott e-mail címe',
      'buy.msg': 'Üzenet az ajándékkártyára',
      'buy.msgPlaceholder': 'Boldog szülinapot! Találkozunk a pályán.',
      'buy.delNow': 'Küldés most e-mailben',
      'buy.delNowSub': 'Fizetés után azonnal megy a megajándékozottnak.',
      'buy.delDate': 'Küldés megadott napon',
      'buy.delDateSub': 'Válaszd ki, mikor érkezzen meg.',
      'buy.delPrint': 'Kinyomtatom magam',
      'buy.delPrintSub': 'Fizetés után letöltheted PDF-ben az ajándékkártyát. A megajándékozott e-mail címét megőrizzük, de nem küldünk neki semmit.',
      'buy.sendOn': 'Küldés napja',
      'buy.sendAt': 'Ekkor',
      'buy.sendNote': 'Budapesti idő szerint. Addig semmi nem megy ki - a saját másolatodat rögtön fizetés után megkapod, hogy tudd, sikerült.',
      'buy.bname': 'A te neved',
      'buy.bemail': 'A te e-mail címed',
      'buy.summary': 'Összesítő',
      'buy.empty': 'Még nincs kiválasztva semmi. Válassz egy vagy több csomagot fent.',
      'buy.each': '{amount} / db',
      'buy.save': 'Megtakarítás',
      'buy.total': 'Összesen',
      'buy.pay': 'Fizetés kártyával',
      'buy.payAmount': 'Fizetés - {amount}',
      'buy.paying': 'Fizetés…',
      /* Hungarian wants the accusative here, so the noun is written into the
         sentence rather than slotted in as a bare word. */
      'buy.nudge': 'Végy még {n} szessziót, és <strong>{pct}%</strong> kedvezményt kapsz mindenre',
      'buy.noCard': 'A kártyaadataidat soha nem látjuk.',
      'buy.codeOne': 'A kódot a fizetés beérkezésekor azonnal kiállítjuk.',
      'buy.codeMany': '{n} külön utalványkódot kapsz, utalványonként egyet.',
      'buy.refund': 'Visszatérítési kérelemmel {email}.',
      'buy.haveVoucher': 'Már van utalványod? {link}.',
      'buy.redeemHere': 'Itt beválthatod',
      'buy.mayChange': 'Az időpontok változhatnak vagy elmaradhatnak - lásd a {terms}.',
      'buy.errPackage': 'Válassz legalább egy csomagot.',
      'buy.errRecipient': 'Szükségünk van a megajándékozott érvényes e-mail címére.',
      'buy.errBuyer': 'Add meg az e-mail címed, hogy el tudjuk küldeni a visszaigazolást.',
      'buy.errDate': 'Válaszd ki, melyik napon érkezzen az ajándék.',
      'buy.errPast': 'Ez a küldési dátum a múltban van.',
      'buy.errNoPay': 'A kártyás fizetés még nincs bekapcsolva. Kérlek, próbáld újra hamarosan.',
      'buy.errStart': 'Nem tudtuk elindítani a fizetést. Nem történt terhelés.',
      'buy.errNet': 'Nem értük el a szervert. Ellenőrizd a kapcsolatot és próbáld újra - nem történt terhelés.',
      'buy.errCard': 'A fizetés nem ment át. Nem történt terhelés - próbáld újra vagy másik kártyával.',
      'buy.errLoad': 'Nem sikerült betölteni a csomagokat. Frissíts, vagy {email}.',

      'red.title': 'Ajándékutalvány beváltása - Balaton Park Circuit',
      'red.step1': '1. lépés a 2-ből · A kódod',
      'red.h1': 'Váltsd be az utalványod.',
      'red.lede': 'Add meg az ajándékkártyán szereplő kódot. A pályanapokat a következő lépésben választod ki.',
      'red.codeLabel': 'Utalványkód',
      'red.continue': 'Tovább',
      'red.checking': 'Ellenőrzés…',
      'red.lost': 'Elveszett a kód? {email} a vásárló nevével, és megkeressük.',
      'red.emailUs': 'Írj nekünk',
      'red.tooShort': 'Ez a kód túl rövidnek tűnik. Tizenkét karakter, például BPC-ABCD-1234.',
      'red.step2': '2. lépés a 2-ből · {left} / {total} maradt',
      'red.h2fresh': 'Válassz napot és darabszámot.',
      'red.h2more': 'A többit akkor költöd el, amikor akarod.',
      'red.leftOne': 'még {n} szesszió',
      'red.leftMany': 'még {n} szesszió',
      'red.different': 'Másik kódot adok meg',
      'red.already': 'Kódok, amiket már megkaptál',
      'red.introFresh': 'A {n} szessziód lefuthat egyetlen napon, vagy eloszthatod több nap között.',
      'red.introMore': 'Költs el ezen a napon annyit, amennyit szeretnél - a többiért bármikor visszatérhetsz.',
      'red.notice': 'A 2027-es pályanapokra a regisztráció 2027 januárjában nyílik meg a Cooltixon. Váltsd be most, a kódod megvár. A nyitásról a közösségi oldalainkon és a hírlevélben szólunk - {subscribe}. Egy szesszió 25 perc.',
      'red.subscribe': 'iratkozz fel itt',
      'red.whichDay': '1 · Melyik nap',
      'red.howMany': '2 · Hány szesszió',
      'red.howManyOn': '2 · Hány szesszió - {day}',
      'red.hint': 'Még {n} maradt. Minden kiválasztott csoportból külön Cooltix kód lesz arra a napra.',
      'red.hintPickDay': 'Előbb válassz napot.',
      'red.alreadyHere': 'már {n} ide',
      'red.all': 'Mind a {n}',
      'red.getCode': 'Kérem a kódom',
      'red.getCodeFor': 'Kérem a kódom {n} {sessions}ra',
      'red.issuing': 'Kód kiállítása…',
      'red.footAll': 'A dátum kiválasztása még nem foglalás - kedvezménykódot kapsz, amit a Cooltixon használsz fel.',
      'red.footSome': 'Még {n} {sessions} marad, bármikor a 2027-es szezonban.',
      'red.soon': 'Hamarosan továbbiak!',
      'red.issued': 'Utalvány beváltva',
      'red.issuedH': 'Kód kiállítva.',
      'red.doneH': 'Minden megvan.',
      'red.issuedLede': 'Az <strong>{day}</strong> napra szóló Cooltix kedvezménykódod alább található. A regisztráció 2027 januárjában nyílik - a kód addig megvár.',
      'red.yourCode': 'A Cooltix kedvezménykódod',
      'red.validFor': 'Érvényes',
      'red.validForV': 'csak {day}',
      'red.covers': 'Mire szól',
      'red.uses': 'Felhasználás',
      'red.usesV': 'Egyszeri',
      'red.stepsA': 'Mi történik',
      'red.stepsB': 'a Cooltixon.',
      'red.cstep1': 'Illeszd be a kódot a kedvezmény mezőbe, <strong>mielőtt bármit kosárba teszel</strong>.',
      'red.cstep2': 'Tedd kosárba a {n} {sessions}t erre a napra: {day}.',
      'red.cstep3': 'A szessziók ingyenesként jelennek meg. Fejezd be a fizetést, és megkapod a jegyed.',
      'red.warn': 'A kód csak erre a napra érvényes: {day}, és lejár, amikor az adott nap értékesítése lezárul. Ha másik dátum kell, ne használd fel - {email}, és kicseréljük.',
      'red.more': 'Még {n} {sessions} beváltása',
      'red.back': 'Vissza az ajándékutalványokhoz',
      'red.spent': 'Utalvány teljesen beváltva',
      'red.spentH': 'Minden szesszió felhasználva.',
      'red.spentLede': 'A(z) <strong>{code}</strong> minden szesszióját beváltottad. Itt vannak a belőle készült kódok - ezek továbbra is érvényesek.',
      'red.yourCodes': 'A Cooltix kódjaid',
      'red.needDate': 'Másik dátum kell? {email}, és kicseréljük. · {buy}',
      'red.buyAnother': 'Veszek még egy utalványt',
      'red.errNotFound': 'Nem találjuk ezt a kódot. Ellenőrizd az ajándékkártyán - csak betűk és számok, a szóközök nem számítanak.',
      'red.errExpired': 'Ez az utalvány lejárt. Írj nekünk, és megnézzük, mit tehetünk.',
      'red.errVoid': 'Ez az utalvány nem váltható be - lehet, hogy visszatérítettük. Ha ez meglepő, írj nekünk.',
      'red.errRate': 'Túl sok próbálkozás. Várj pár percet, és próbáld újra.',
      'red.errPool': 'Erre a napra épp elfogytak a kódok ehhez az utalványtípushoz. Válassz másik dátumot, vagy írj nekünk.',
      'red.errCombo': 'Ez a kombináció erre a napra nem elérhető. Próbálj másik szesszió-számot.',
      'red.errCount': 'Ez nem egyezik azzal, ami az utalványon maradt. Frissíts és próbáld újra.',
      'red.errSplit': 'Ezt az utalványt egyben kell beváltani, egyetlen napra.',
      'red.errServer': 'Nálunk hibázott valami, nem nálad. Próbáld újra egy pillanat múlva.',
      'red.errNet': 'Nem értük el a szervert. Ellenőrizd a kapcsolatot és próbáld újra.',
      'red.errGeneric': 'Valami hiba történt. Próbáld újra, vagy írj nekünk.',

      'ty.title': 'Köszönjük - Balaton Park Circuit',
      'ty.eyebrow': 'Fizetés megérkezett',
      'ty.h1': 'Köszönjük.',
      'ty.h1one': 'Az utalványod kész.',
      'ty.h1many': 'Az utalványaid készen állnak.',
      'ty.confirming': 'Fizetés megerősítése…',
      'ty.slow': 'A fizetés sikerült, de az utalvány a szokásosnál tovább készül. Hamarosan megérkezik e-mailben - semmi nem veszett el.',
      'ty.noOrder': 'Nem tudjuk, melyik rendelésről van szó. Ha most fizettél, nézd meg a postaládád - a visszaigazolásban ott az utalványkód.',
      'ty.unreachable': 'Nem értük el a szervert a rendelés megerősítéséhez. A fizetésed biztonságban van - nézd meg a postaládád, vagy küldd el nekünk ennek az oldalnak a címét.',
      'ty.problemEyebrow': 'Valami félrement',
      'ty.problemH': 'Egy pillanat.',
      'ty.contactFix': '{contact}, és megoldjuk.',
      'ty.refundedEyebrow': 'Rendelés visszatérítve',
      'ty.refundedH': 'Ezt a rendelést visszatérítettük.',
      'ty.refundedBody': 'Az ehhez a rendeléshez tartozó utalvány már nem érvényes. Ha ez meglepő, {contact}.',
      'ty.nextPrint': 'Nem küldtünk semmit {name} részére. Nyomtasd ki vagy add át az alábbi {codes}, amikor szeretnéd.',
      'ty.nextSched': 'Az ajándék {date} napon megy ki ide: {email}. Addig az alábbi {codes} - őrizd meg ezt az oldalt.',
      'ty.nextSent': 'Elküldtük az ajándékot ide: {recipient}, és egy másolatot neked ide: {buyer}.',
      'ty.nextPending': 'Az utalványod alább található. Hamarosan elküldjük ide: {recipient} - addig mentsd el ezt az oldalt vagy a kódot.',
      'ty.codeOne': 'kód',
      'ty.codeMany': 'kódok',
      'ty.voucherOf': '{name} · {i}. utalvány a {n}-ből',
      'ty.covers': 'Mire szól',
      'ty.validUntil': 'Érvényes eddig',
      'ty.redeemAt': 'Beváltás itt',
      'ty.redeemNow': 'Beváltom most',
      'ty.buyAnother': 'Veszek még egyet',
      'ty.paidOn': 'Fizetve: {amount}, {date}. Őrizd meg ezt az oldalt vagy az e-mailt - a {codes} az, amit beváltasz. Elveszett? {contact}.',

      'nf.title': 'Az oldal nem található - Balaton Park Circuit',
      'nf.h1': 'Rossz irányba mentél a pályán.',
      'nf.lede': 'Ez az oldal nincs itt. Lehet, hogy a link régi, vagy elgépelted - nálad semmi nem romlott el.',
      'nf.vouchers': 'Ajándékutalványok',
      'nf.redeem': 'Utalvány beváltása',
      'nf.help': 'Valami konkrétat keresel? {contact}, és megmutatjuk, merre van.'
    }
  };

  var lang = pick();

  function pick() {
    var saved = null;
    try { saved = localStorage.getItem(STORE); } catch (e) { /* blocked storage */ }
    if (saved === 'hu' || saved === 'en') return saved;
    // Hungarian for a Hungarian browser, wherever the visitor happens to be;
    // a Hungarian abroad still reads Hungarian, and an IP lookup would get
    // that backwards.
    var want = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
    return /^hu/i.test(want) ? 'hu' : 'en';
  }

  function t(key, vars) {
    var s = (STRINGS[lang] && STRINGS[lang][key]);
    if (s === undefined) s = STRINGS.en[key];
    if (s === undefined) return key;
    if (!vars) return s;
    return s.replace(/\{(\w+)\}/g, function (m, name) {
      return vars[name] === undefined ? m : vars[name];
    });
  }

  // Hungarian writes dates big-endian and lowercases the month.
  function formatDate(value, opts) {
    if (!value) return '';
    var d = new Date(value);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(lang === 'hu' ? 'hu-HU' : 'en-GB',
      opts || { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function money(cents) {
    var n = Math.round(Number(cents) || 0) / 100;
    return '€' + n.toLocaleString(lang === 'hu' ? 'hu-HU' : 'en-IE',
      { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }

  var listeners = [];
  function onChange(fn) { listeners.push(fn); }

  function apply(root) {
    (root || document).querySelectorAll('[data-i18n]').forEach(function (n) {
      n.innerHTML = t(n.getAttribute('data-i18n'));
    });
    (root || document).querySelectorAll('[data-i18n-ph]').forEach(function (n) {
      n.setAttribute('placeholder', t(n.getAttribute('data-i18n-ph')));
    });
    (root || document).querySelectorAll('[data-i18n-title]').forEach(function (n) {
      document.title = t(n.getAttribute('data-i18n-title'));
    });
    document.documentElement.lang = lang;
  }

  function set(next) {
    if (next === lang) return;
    lang = next;
    try { localStorage.setItem(STORE, next); } catch (e) {}
    apply();
    paintSwitch();
    listeners.forEach(function (fn) { try { fn(lang); } catch (e) {} });
  }

  function paintSwitch() {
    document.querySelectorAll('.langpick button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.lang === lang ? 'true' : 'false');
    });
  }

  // Mounted by each page into its header row, opposite the logo.
  function mountSwitch(host) {
    if (!host) return;
    host.className = 'langpick';
    host.setAttribute('role', 'group');
    host.setAttribute('aria-label', t('lang.switch'));
    host.innerHTML =
      '<button type="button" data-lang="hu">HU</button>' +
      '<button type="button" data-lang="en">EN</button>';
    host.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-lang]');
      if (b) set(b.dataset.lang);
    });
    paintSwitch();
  }

  global.i18n = {
    get lang() { return lang; },
    t: t,
    set: set,
    apply: apply,
    onChange: onChange,
    mountSwitch: mountSwitch,
    formatDate: formatDate,
    money: money
  };
})(window);
