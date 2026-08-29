export interface Contact {
    id: string;
    name: string;
    birthday: Date;
    notes: string;
    photoUrl: string;
    starred: boolean;

    emails?: ContactEmail[];
    phoneNumbers?: ContactPhoneNumber[];
    addresses?: ContactAddress[];
    organizations?: ContactOrganization[];
    relations?: ContactRelation[];
    events?: ContactEvent[];
    customFields?: ContactCustomField[];
    lastModified?: Date;
}

export interface ContactEmail {
    value: string;
    type?: 'home' | 'work' | 'other' | string;
    primary?: boolean;
}

export interface ContactPhoneNumber {
    value: string;
    type?: 'mobile' | 'home' | 'work' | 'fax' | 'pager' | 'other' | string;
    primary?: boolean;
}

export interface ContactAddress {
    type?: 'home' | 'work' | 'other' | string;
    formatted?: string;
    streetAddress?: string;
    city?: string;
    region?: string; // State or province
    postalCode?: string;
    country?: string;
    primary?: boolean;
}

export interface ContactOrganization {
    name?: string;
    department?: string;
    title?: string;
    type?: 'work' | 'other' | string;
    primary?: boolean;
}

export interface ContactRelation {
    person?: string;
    type?: 'spouse' | 'child' | 'mother' | 'father' | 'friend' | 'assistant' | 'manager' | string;
}

export interface ContactEvent {
    type?: 'birthday' | 'anniversary' | string;
    date: Date;
}

export interface ContactCustomField {
    key: string;
    value: string;
}
