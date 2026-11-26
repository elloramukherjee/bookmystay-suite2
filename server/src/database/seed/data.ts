/**
 * Realistic sample data for one fictional heritage property in Jaipur, used for development and demos.
 * No secrets here: staff passwords come from SEED_DEFAULT_PASSWORD or are generated at seed time.
 * Photo URLs are the imagery supplied with the Stitch design.
 */

const IMG = {
  courtyard:
    'https://lh3.googleusercontent.com/aida-public/AB6AXuCeIRLjp6HgimauI52vMtwk-Opj6y7Oea9PdTxPEq2NFJPD8JeOci-VC5s-ES7Xr51ZEw5_R-C1KE_fk-v4PLBbhBgvmE-kbS6gLSDvf9JdppX6f1r0YZdTji7aRwvajUGVLrT7Xca9iQQ3DwNbb2yURYKhwhLnqR0RCLVuusbIm2s0WAPBrLYbg-MCybK4RgBV_5OQE1eEbUao2C9d4IzU8QrRho5LyTMP-Hsyy8M',
  deluxeSuite:
    'https://lh3.googleusercontent.com/aida-public/AB6AXuDVCt3BfY0S_qlImqfMmiVEhJ7HE43WaXpl717RvZfuS2cGDZ6C02I0B3Frb15J3bp7i2fiyvcpwvvv8t4YQGv5RK3aHgPmlmJ_YUa0dk6w6gK-PwK14lhYfdkfunOOI4jAS291XGXmUY7uAB-FoJ7mvE0MMo9IdaIk8ANBizPeg4qsyHc5tgEPoXHOfeEVpEuU-B1V2RQIHwfZkC7qYRAGswm539Aaz3ghGvFsekg',
  // Replaces a Stitch-generated image that had a booking-UI mock-up baked into the picture.
  jharokha: 'https://images.pexels.com/photos/262048/pexels-photo-262048.jpeg?auto=compress&cs=tinysrgb&w=1280',
  penthouse:
    'https://lh3.googleusercontent.com/aida-public/AB6AXuDNunmHkOyiQhcDzU6SJjXxR_3T9upAU41ewUvUIrznIpeMyc-NkRQAFiKtjD2PkoszSxIpcmJg0GSqWcf4NEIOjX6euFm8qCXzmiVS8BkRsrc_zMTuFYstBJWBfXzpRgi1KJ8rAIYtEbp5h8SDTw4CowMuE6JSo95-No5iuwbPAiDBbNPe4IPhZEBE3Yp9W9auS9W3HyFgNRtF3JvcOVgokacs4Xd0trZvT1P2YQQ',
  lobby: 'https://images.pexels.com/photos/271624/pexels-photo-271624.jpeg?auto=compress&cs=tinysrgb&w=1280',
  garden: 'https://images.pexels.com/photos/164595/pexels-photo-164595.jpeg?auto=compress&cs=tinysrgb&w=800',
};

export const SEED_HOTEL = {
  name: 'The Heritage Courtyard Haveli',
  slug: 'heritage-courtyard-jaipur',
  tagline: 'Authentic Jaipur haveli stays, honoured with direct hospitable rates.',
  story:
    'Circa 1892 sandstone courtyards, hand-painted jharokhas and organic farm-to-thali dining in the old walled city. ' +
    'Book direct to unlock privileges without OTA platform mark-ups — every rupee of commission saved is reinvested in our ' +
    'local artisans, cooks and craftspeople.',
  starRating: 4,
  verified: true,
  address: {
    line1: '14 Gangori Bazaar Road',
    line2: 'Near Tripolia Gate',
    locality: 'C-Scheme, Old Heritage Zone',
    city: 'Jaipur',
    state: 'Rajasthan',
    pincode: '302002',
    country: 'IN',
    geo: { lat: 26.9239, lng: 75.8267 },
  },
  contact: { phone: '+919876543210', whatsapp: '+919876543210', email: 'stay@heritagecourtyard.example' },
  gstin: '08ABCDE1234F1Z5',
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  totalRooms: 24,
  checkInTime: '13:00',
  checkOutTime: '11:00',
  photos: [
    {
      url: IMG.courtyard,
      alt: 'Sunlit sandstone courtyard with arched stone corridors, carved jaali screens and brass lanterns',
      caption: 'The Central Chattris',
      isHero: true,
    },
    {
      url: IMG.deluxeSuite,
      alt: 'Heritage suite with a four-poster teak bed and French doors opening onto a stone courtyard',
      caption: 'Deluxe Courtyard Suite',
      isHero: false,
    },
    { url: IMG.jharokha, alt: 'Heritage room with carved wooden furniture and warm lighting', caption: 'Heritage Jharokha Room', isHero: false },
    {
      url: IMG.penthouse,
      alt: 'Rooftop penthouse with marble arches and a plunge pool overlooking the old city forts',
      caption: 'Royal Haveli Penthouse',
      isHero: false,
    },
    { url: IMG.lobby, alt: 'Warmly lit lounge with heritage furniture', caption: 'Diwan-e-Khas lounge', isHero: false },
    { url: IMG.garden, alt: 'Quiet garden seating under shade trees', caption: 'Bagh garden', isHero: false },
  ],
  amenities: [
    'Free high-speed Wi-Fi',
    'Complimentary valet parking',
    'Farm-to-thali restaurant',
    'Rooftop terrace',
    'Airport & railway transfers',
    'Daily housekeeping',
    'Folk music evenings',
    'Ayurvedic spa',
    'Power backup',
    '24-hour front desk',
  ],
  highlights: [
    { label: 'Arrival perk', value: 'Welcome thali' },
    { label: 'Check-out', value: '2:00 PM extended (direct)' },
    { label: 'Payment mode', value: 'Direct UPI, zero fee' },
    { label: 'Voucher speed', value: 'Instant on WhatsApp' },
  ],
  reviews: [
    {
      author: 'Ananya Kulkarni',
      city: 'Mumbai',
      rating: 5,
      stayedAt: '2024-09',
      roomTypeName: 'Deluxe Courtyard Suite',
      source: 'direct' as const,
      savedPaise: 290000,
      text: 'We initially searched on an OTA but found this direct page. The UPI checkout was silky smooth, the voucher arrived on WhatsApp immediately, and the 2 PM checkout saved our Jaipur flight day.',
    },
    {
      author: 'Devendra Mehta',
      city: 'Bengaluru',
      rating: 5,
      stayedAt: '2024-09',
      roomTypeName: 'Heritage Jharokha Room',
      source: 'direct' as const,
      savedPaise: 320000,
      text: 'The Heritage Jharokha window with evening tea is pure magic. The duty manager personally checked in on us via WhatsApp. Zero middleman headache.',
    },
    {
      author: 'Pooja & Siddharth',
      city: 'Delhi NCR',
      rating: 4,
      stayedAt: '2024-10',
      roomTypeName: 'Royal Haveli Penthouse',
      source: 'direct' as const,
      savedPaise: 520000,
      text: 'Private plunge pool suite is world-class. Transparent GST breakdown, quick Google Pay single-click payment, and delicious hot kachoris on arrival.',
    },
  ],
  modules: { booking: true, receptionist: true, crm: true },
  settings: {
    directDiscountPercent: 10,
    otaCommissionRate: 18,
    holdMinutes: 15,
    freeCancellationHours: 48,
    taxSlabs: [
      { upToPaise: 100000, ratePercent: 0 },
      { upToPaise: 750000, ratePercent: 5 },
      { upToPaise: null, ratePercent: 18 },
    ],
    promoCodes: [{ code: 'DIRECTSTAY', percentOff: 5, active: true, validUntil: null }],
  },
  integrations: { paymentProvider: 'mock' as const, smsProvider: 'console' as const, whatsappPhoneNumberId: null },
  status: 'active' as const,
};

export const SEED_STAFF = [
  { name: 'Platform Support', email: 'support@bookmystay.example', role: 'super_admin' as const, phone: null, hotelBound: false },
  { name: 'Vikramaditya Singh', email: 'owner@heritagecourtyard.example', role: 'owner' as const, phone: '+919820144552', hotelBound: true },
  { name: 'Meera Rathore', email: 'manager@heritagecourtyard.example', role: 'manager' as const, phone: '+919829011223', hotelBound: true },
  { name: 'Mohan Lal', email: 'frontdesk@heritagecourtyard.example', role: 'front_desk' as const, phone: '+919783344556', hotelBound: true },
];

const rupees = (r: number) => r * 100;

export const SEED_ROOM_TYPES = [
  {
    name: 'Deluxe Courtyard Suite',
    slug: 'deluxe-courtyard-suite',
    description:
      'Opens onto the ground-level sandstone courtyard. Four-poster teak bed, hand-block-printed linens and lime-plaster walls that stay cool through the afternoon.',
    sizeSqft: 380,
    maxAdults: 2,
    maxChildren: 1,
    maxOccupancy: 3,
    bedType: 'King four-poster',
    view: 'Courtyard',
    amenities: ['King pillowtop bed', 'Stone balcony', 'High-speed Wi-Fi', 'Rain shower', 'Air conditioning'],
    photos: [{ url: IMG.deluxeSuite, alt: 'Heritage suite with a four-poster teak bed and French doors opening onto a stone courtyard' }],
    tags: ['Ground-level courtyard view'],
    directPrivilege: 'Early check-in from 11 AM + 15% off haveli dining',
    baseRatePaise: rupees(4800),
    otaRatePaise: rupees(5900),
    sortOrder: 1,
    units: ['101', '102', '103', '104', '105', '106', '107', '108', '109', '110', '111', '112'],
  },
  {
    name: 'Heritage Jharokha Room',
    slug: 'heritage-jharokha-room',
    description: 'Upper-floor room built around a carved sandstone jharokha window seat, with restored royal ceiling frescoes and a copper soaking tub.',
    sizeSqft: 460,
    maxAdults: 2,
    maxChildren: 1,
    maxOccupancy: 3,
    bedType: 'King',
    view: 'Old city & gardens',
    amenities: ['Silk jharokha seat', 'Copper soaking tub', 'Welcome thali', 'Evening chai service', 'Air conditioning'],
    photos: [{ url: IMG.jharokha, alt: 'Heritage room with carved wooden furniture and warm lighting' }],
    tags: ['Upper chattri view'],
    directPrivilege: 'Sunset chai set-up on the private roof terrace',
    baseRatePaise: rupees(6400),
    otaRatePaise: rupees(7800),
    sortOrder: 2,
    units: ['201', '202', '203', '204', '205', '206', '207', '208', '209'],
  },
  {
    name: 'Royal Haveli Penthouse',
    slug: 'royal-haveli-penthouse',
    description: 'The haveli’s rooftop suite: marble arches, antique brass chandeliers and a private plunge pool facing the Aravalli forts.',
    sizeSqft: 850,
    maxAdults: 3,
    maxChildren: 2,
    maxOccupancy: 4,
    bedType: 'Super king',
    view: 'Panoramic Aravalli',
    amenities: ['Private plunge pool', 'Heritage lounge', 'Private chef dinner', 'Airport chauffeur', 'Butler service'],
    photos: [{ url: IMG.penthouse, alt: 'Rooftop penthouse with marble arches and a plunge pool overlooking the old city forts' }],
    tags: ['Private terrace & plunge pool'],
    directPrivilege: 'Complimentary airport chauffeur both ways',
    baseRatePaise: rupees(11900),
    otaRatePaise: rupees(14500),
    sortOrder: 3,
    units: ['301', '302', '303'],
  },
];

export const SEED_RATE_PLANS = [
  { name: 'Room only', code: 'EP', mealPlan: 'EP' as const, adjustmentPaise: 0, isDefault: true },
  { name: 'Bed & breakfast', code: 'CP', mealPlan: 'CP' as const, adjustmentPaise: rupees(800), isDefault: false },
];

export const SEED_POLICIES = [
  {
    type: 'cancellation' as const,
    title: 'Cancellation & refunds',
    body: 'Free cancellation up to 48 hours before check-in (1:00 PM on your arrival day). After that, the first night including GST is charged and the rest is refunded. No-shows are charged the first night. Refunds go back to your original payment method within 5–7 working days.',
  },
  {
    type: 'checkin' as const,
    title: 'Check-in & check-out',
    body: 'Check-in is from 1:00 PM and check-out is by 11:00 AM. Early check-in and late check-out depend on availability — ask us on WhatsApp and we will confirm. Direct bookers get early check-in from 11:00 AM when the room is ready.',
  },
  {
    type: 'id_proof' as const,
    title: 'ID at check-in',
    body: 'Every adult guest needs a government photo ID at check-in (Aadhaar, passport, driving licence or voter ID). Foreign nationals need a passport and valid visa; we file Form C as required by law.',
  },
  {
    type: 'parking' as const,
    title: 'Parking',
    body: 'Complimentary valet parking for one car per room inside the haveli compound, including SUVs such as Innova Crysta. Tempo travellers can park in the public lot 200 m away.',
  },
  {
    type: 'pets' as const,
    title: 'Pets',
    body: 'We are unable to host pets, except certified service animals. Please tell us in advance if you are travelling with one.',
  },
  {
    type: 'children' as const,
    title: 'Children & extra beds',
    body: 'Children under 6 stay free using existing bedding. An extra bed (or a mattress for a child) can be added for ₹1,200 per night including breakfast, subject to room size.',
  },
  {
    type: 'smoking' as const,
    title: 'Smoking',
    body: 'All rooms and indoor areas are non-smoking. Smoking is allowed only in the designated area of the garden.',
  },
  {
    type: 'payment' as const,
    title: 'Payment',
    body: 'Direct bookings are paid online by UPI, card or netbanking with zero convenience fees. GST is shown separately before you pay. A GST invoice is issued on check-out.',
  },
];

/** Relative-day sample bookings: negative = in the past. `status` drives guest stats and inventory. */
export const SEED_GUESTS = [
  { key: 'arjun', name: 'Arjun Singhania', phone: '+919820244552', email: 'arjun.singhania@example.com', city: 'Mumbai', marketing: true },
  { key: 'priya', name: 'Priya Mukherjee', phone: '+919433018274', email: 'priya.m@example.com', city: 'Kolkata', marketing: true },
  { key: 'rohit', name: 'Rohit Sharma', phone: '+919811059281', email: null, city: 'New Delhi', marketing: false },
  { key: 'devendra', name: 'Devendra Rathore', phone: '+919724533219', email: null, city: 'Ahmedabad', marketing: false },
  { key: 'rajesh', name: 'Rajesh Kumar', phone: '+919811234567', email: 'rajesh.k@example.com', city: 'Gurugram', marketing: false },
  { key: 'ananya', name: 'Ananya Kulkarni', phone: '+919867012345', email: 'ananya.k@example.com', city: 'Mumbai', marketing: true },
  { key: 'anand', name: 'Anand Mehta', phone: '+919899876543', email: null, city: 'Delhi', marketing: false },
  { key: 'meera', name: 'Meera Iyer', phone: '+919845012399', email: 'meera.iyer@example.com', city: 'Bengaluru', marketing: true },
];

export const SEED_BOOKINGS: ReadonlyArray<{
  guest: string;
  roomType: string;
  source: 'direct' | 'ota_mmt' | 'ota_bookingcom' | 'ota_agoda';
  from: number;
  nights: number;
  status: 'confirmed' | 'checked_in' | 'checked_out';
  room?: string;
  adults: number;
  children?: number;
}> = [
  { guest: 'arjun', roomType: 'deluxe-courtyard-suite', source: 'ota_mmt', from: -400, nights: 2, status: 'checked_out', room: '104', adults: 2 },
  { guest: 'arjun', roomType: 'heritage-jharokha-room', source: 'direct', from: -200, nights: 3, status: 'checked_out', room: '206', adults: 2 },
  { guest: 'arjun', roomType: 'deluxe-courtyard-suite', source: 'direct', from: -60, nights: 2, status: 'checked_out', room: '105', adults: 2 },
  { guest: 'arjun', roomType: 'heritage-jharokha-room', source: 'direct', from: 20, nights: 3, status: 'confirmed', adults: 2 },
  { guest: 'priya', roomType: 'deluxe-courtyard-suite', source: 'direct', from: -90, nights: 2, status: 'checked_out', room: '102', adults: 1 },
  { guest: 'priya', roomType: 'deluxe-courtyard-suite', source: 'direct', from: 0, nights: 2, status: 'confirmed', adults: 1 },
  { guest: 'rohit', roomType: 'royal-haveli-penthouse', source: 'direct', from: 5, nights: 2, status: 'confirmed', adults: 3, children: 1 },
  { guest: 'devendra', roomType: 'deluxe-courtyard-suite', source: 'ota_bookingcom', from: -30, nights: 2, status: 'checked_out', room: '108', adults: 2 },
  { guest: 'rajesh', roomType: 'deluxe-courtyard-suite', source: 'direct', from: 0, nights: 3, status: 'confirmed', adults: 2, children: 1 },
  { guest: 'ananya', roomType: 'deluxe-courtyard-suite', source: 'direct', from: -45, nights: 2, status: 'checked_out', room: '101', adults: 2 },
  { guest: 'anand', roomType: 'heritage-jharokha-room', source: 'ota_agoda', from: -10, nights: 3, status: 'checked_out', room: '203', adults: 2 },
  { guest: 'meera', roomType: 'heritage-jharokha-room', source: 'direct', from: -1, nights: 2, status: 'checked_in', room: '204', adults: 2 },
];
