// ===================== FLEETHIVE — BREE KNOWLEDGE BASE =====================
// Single source of truth for everything Bree (the website assistant) is
// allowed to say. This file holds DATA ONLY — no chat logic, no DOM code.
// The conversation engine lives in site.js and reads from window.BREE_KB.
//
// Update prices, plan details, or copy here and every page picks it up
// automatically — nothing else needs to change.
//
// Categories mirror the site's own information architecture:
// company, plans, tagPlan, hiveCredits, solutions, howItWorks,
// installation, partnership, contact, login, faq, destinations.

window.BREE_KB = {

  company: {
    name: 'FleetHive Innovation',
    summary: 'FleetHive is a smart mobility and vehicle intelligence company, helping individuals and businesses understand, monitor and track their vehicles, with a broader vision for smart mobility across Africa and beyond.',
    whatWeHelpWith: [
      'Understand their vehicles',
      'Monitor vehicles',
      'Track vehicle movement',
      'Receive useful alerts',
      'Understand vehicle activity',
      'Improve fleet visibility',
      'Make better vehicle/fleet decisions'
    ]
  },

  plans: {
    lite:  {name:'Lite',  price:'₦4,000/mo (₦42,000/yr)',  fit:'a single personal vehicle, mainly for location and trip history'},
    pro:   {name:'Pro',   price:'₦6,000/mo (₦60,000/yr)',  fit:'small business fleets that need fuel and driver oversight, not just location', badge:'MOST RECOMMENDED'},
    prime: {name:'Prime', price:'₦12,000/mo (₦120,000/yr)', fit:"fleets that want FleetHive's team actively monitoring and reporting alongside them", note:'Available for vehicles from 2006 upward.'}
  },

  tagPlan: {
    startCost: '₦35,000 for one FleetTag',
    free: 'the first 3 months of tracking are free',
    renewal: 'then ₦3,000/mo or ₦30,000/yr (saves ₦6,000 a year)',
    note: 'the ₦3,000/mo and ₦30,000/yr prices are renewal prices, they are not charged at purchase, only ₦35,000 per tag is charged upfront',
    uses: 'packages, orders, assets, vehicles and other trackable items',
    tagUnitCost: 35000,
    reusable: 'The FleetTag is reusable and can be attached to a vehicle, asset, parcel or other item you want to track.'
  },

  hiveCredits: {
    desc: 'Hive Credits are prepaid credits for tracking and support services, separate from the Tag Plan subscription, they are not compulsory and not the same as the renewal fee',
    amounts: '₦5,000, ₦10,000, ₦20,000, ₦50,000 or a custom amount'
  },

  solutions: {
    tracking:  'Live Vehicle Tracking, real-time location, so you know where a vehicle is without depending on phone calls.',
    trips:     'Trips & Activity, a clear history of where a vehicle has been and how it\'s being used.',
    alerts:    'Smart Alerts, notified the moment something needs attention, instead of finding out later.',
    zones:     'Smart Zones, set routes and no-go areas, and get told the moment a vehicle leaves them.',
    intel:     'Vehicle Intelligence, raw activity turned into information you can actually act on.',
    tags:      'Fleet Tags, tracking for assets beyond vehicles, for things you move but can\'t install a full device on.'
  },

  howItWorks: {
    steps: ['Install the tracking device', 'Connect it to the platform', 'Monitor location, trips and alerts live', 'Act on what you see'],
    summary: 'Four steps: Install, Connect, Monitor, Act. Most customers are live the same day.'
  },

  installation: {
    summary: 'A technician installs the FleetHive tracking device in your vehicle, it connects to the platform, and your dashboard goes live the same day, no long onboarding.',
    locations: ['Lagos', 'Abuja', 'Port Harcourt', 'Ibadan', 'Kano', 'Enugu'],
    outsideLocations: "Let me connect you with the FleetHive team so we can confirm the available installation option for your location."
  },

  partnership: {
    summary: 'The Partner Program is for installers, ICT consultants, mobility companies and resellers, you earn recurring revenue selling and deploying FleetHive.'
  },

  contact: {
    email: 'support@fleethive.in',
    whatsapp: 'https://wa.me/2347025771522'
  },

  faq: {
    trial: 'FleetHive does not currently advertise a free trial on subscription plans, Tag Plan includes 3 free months of tracking specifically.',
    cancel: 'For billing or cancellation questions, the FleetHive team can help directly, best reached via the contact page, WhatsApp or support@fleethive.in.'
  },

  // Real destinations Bree can send visitors to with a button instead of just text.
  // Plan links use pricing.html's own ?plan= handling (see pricing.js) so the visitor
  // lands with that exact plan already selected and the order form open — not a fake link.
  destinations: {
    home: 'index.html',
    howItWorks: 'how-it-works.html',
    pricing: 'pricing.html',
    lite: 'pricing.html?plan=lite',
    pro: 'pricing.html?plan=pro',
    prime: 'pricing.html?plan=prime',
    tagPlan: 'pricing.html?plan=tagplan',
    about: 'about.html',
    partners: 'partners.html',
    partnerApply: 'partners.html#partner-application',
    contact: 'contact.html',
    blog: 'blog.html',
    login: 'https://app.fleethive.in'
  }
};
