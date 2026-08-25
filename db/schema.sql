\restrict dbmate

-- Dumped from database version 16.15 (Homebrew)
-- Dumped by pg_dump version 16.15 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: app; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA app;


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: appointment_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.appointment_kind AS ENUM (
    'appointment',
    'blocked',
    'absence',
    'chore',
    'note'
);


--
-- Name: appointment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.appointment_status AS ENUM (
    'booked',
    'confirmed',
    'cancelled',
    'no_show'
);


--
-- Name: checkout_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.checkout_status AS ENUM (
    'PAID',
    'PARTIALLY_PAID',
    'FAILED'
);


--
-- Name: discount_code_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.discount_code_type AS ENUM (
    'Percentage',
    'Fixed amount'
);


--
-- Name: employee_access; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.employee_access AS ENUM (
    'owner',
    'manager',
    'staff',
    'desk'
);


--
-- Name: employee_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.employee_status AS ENUM (
    'active',
    'invited'
);


--
-- Name: invoice_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.invoice_status AS ENUM (
    'Paid',
    'Refunded'
);


--
-- Name: legal_entity_owner; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.legal_entity_owner AS ENUM (
    'salon',
    'supplier'
);


--
-- Name: legal_entity_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.legal_entity_status AS ENUM (
    'pending',
    'verified'
);


--
-- Name: location_lifecycle; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.location_lifecycle AS ENUM (
    'DRAFT',
    'SUBMITTED',
    'UNDER_REVIEW',
    'CHANGES_REQUIRED',
    'RESUBMITTED',
    'APPROVED',
    'ACTIVE',
    'SUSPENDED',
    'CLOSED'
);


--
-- Name: modifier_group_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.modifier_group_type AS ENUM (
    'single',
    'multi'
);


--
-- Name: mtx_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.mtx_status AS ENUM (
    'paid',
    'failed',
    'config_incomplete'
);


--
-- Name: payment_account_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_account_status AS ENUM (
    'active',
    'incomplete'
);


--
-- Name: purchase_order_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.purchase_order_status AS ENUM (
    'draft',
    'approval',
    'submitted',
    'accepted',
    'partial',
    'processing',
    'shipped',
    'partdelivered',
    'delivered',
    'cancelled',
    'disputed'
);


--
-- Name: registration_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.registration_status AS ENUM (
    'pending_review',
    'under_review',
    'changes_required',
    'resubmitted',
    'active',
    'declined'
);


--
-- Name: schedule_exception_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.schedule_exception_source AS ENUM (
    'MANUAL',
    'PUBLIC_HOLIDAY'
);


--
-- Name: schedule_exception_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.schedule_exception_type AS ENUM (
    'CLOSED',
    'CUSTOM_HOURS'
);


--
-- Name: service_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.service_status AS ENUM (
    'active',
    'draft'
);


--
-- Name: stock_movement_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.stock_movement_kind AS ENUM (
    'adjustment',
    'transfer_in',
    'transfer_out',
    'delivery',
    'sale',
    'own_use'
);


--
-- Name: timing_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.timing_status AS ENUM (
    'none',
    'suggested',
    'approved',
    'dismissed'
);


--
-- Name: widget_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.widget_status AS ENUM (
    'live',
    'draft'
);


--
-- Name: current_tenant(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.current_tenant() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: appointment_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointment_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    appointment_id uuid NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    what text NOT NULL,
    by_name text DEFAULT ''::text NOT NULL,
    source text DEFAULT 'staff'::text NOT NULL
);

ALTER TABLE ONLY public.appointment_history FORCE ROW LEVEL SECURITY;


--
-- Name: appointments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    location_id uuid NOT NULL,
    date date NOT NULL,
    start_min integer NOT NULL,
    duration_min integer NOT NULL,
    prep_min integer DEFAULT 0 NOT NULL,
    reset_min integer DEFAULT 0 NOT NULL,
    kind public.appointment_kind DEFAULT 'appointment'::public.appointment_kind NOT NULL,
    status public.appointment_status DEFAULT 'booked'::public.appointment_status NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    service_id uuid,
    variant_id uuid,
    variant_label text,
    modifier_option_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    modifier_names text[] DEFAULT '{}'::text[] NOT NULL,
    employee_id uuid,
    any_emp boolean DEFAULT false NOT NULL,
    customer_id uuid,
    price integer DEFAULT 0 NOT NULL,
    quoted jsonb,
    source text DEFAULT 'staff'::text NOT NULL,
    deposit integer DEFAULT 0 NOT NULL,
    paid text DEFAULT 'unpaid'::text NOT NULL,
    po_id uuid,
    pmo_id uuid,
    widget_id uuid,
    idempotency_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.appointments FORCE ROW LEVEL SECURITY;


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    actor_employee_id uuid,
    actor_name text NOT NULL,
    role_name text DEFAULT ''::text NOT NULL,
    business_name text DEFAULT ''::text NOT NULL,
    location_name text DEFAULT '—'::text NOT NULL,
    action text NOT NULL,
    object text NOT NULL,
    before text DEFAULT '—'::text NOT NULL,
    after text DEFAULT '—'::text NOT NULL,
    source text DEFAULT ''::text NOT NULL,
    reason text DEFAULT ''::text NOT NULL
);

ALTER TABLE ONLY public.audit_log FORCE ROW LEVEL SECURITY;


--
-- Name: businesses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.businesses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    country text NOT NULL,
    vat text,
    plan text DEFAULT 'Business'::text NOT NULL,
    since date,
    owner_employee_id uuid,
    timing_enabled boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    slug text
);

ALTER TABLE ONLY public.businesses FORCE ROW LEVEL SECURITY;


--
-- Name: checkout_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checkout_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    checkout_id uuid NOT NULL,
    name text NOT NULL,
    qty integer DEFAULT 1 NOT NULL,
    amount integer NOT NULL,
    item_class text NOT NULL,
    seller_legal_entity_id uuid,
    tax_profile_id text,
    merchant_transaction_id uuid
);

ALTER TABLE ONLY public.checkout_items FORCE ROW LEVEL SECURITY;


--
-- Name: checkouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checkouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    customer_id uuid,
    total integer NOT NULL,
    status public.checkout_status DEFAULT 'FAILED'::public.checkout_status NOT NULL
);

ALTER TABLE ONLY public.checkouts FORCE ROW LEVEL SECURITY;


--
-- Name: customer_activity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_activity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    actor_employee_id uuid,
    type text NOT NULL,
    ref_type text DEFAULT ''::text NOT NULL,
    ref_id text DEFAULT ''::text NOT NULL,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL
);

ALTER TABLE ONLY public.customer_activity FORCE ROW LEVEL SECURITY;


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    email text,
    phone text,
    cust_group text DEFAULT 'New'::text NOT NULL,
    since date DEFAULT now() NOT NULL,
    visits integer DEFAULT 0 NOT NULL,
    spend integer DEFAULT 0 NOT NULL,
    points integer DEFAULT 0 NOT NULL,
    prepaid integer DEFAULT 0 NOT NULL,
    blacklisted boolean DEFAULT false NOT NULL,
    no_shows integer DEFAULT 0 NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    birthday date,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    premium jsonb
);

ALTER TABLE ONLY public.customers FORCE ROW LEVEL SECURITY;


--
-- Name: discount_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discount_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    code text NOT NULL,
    type public.discount_code_type NOT NULL,
    value integer NOT NULL,
    used integer DEFAULT 0 NOT NULL,
    usage_limit integer,
    starts date NOT NULL,
    ends date NOT NULL
);

ALTER TABLE ONLY public.discount_codes FORCE ROW LEVEL SECURITY;


--
-- Name: emp_timings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.emp_timings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    service_id uuid NOT NULL,
    variant_id uuid,
    location_id uuid,
    observed_n integer DEFAULT 0 NOT NULL,
    observed_median_min integer,
    pace_factor numeric(5,2),
    window_from date,
    window_to date,
    computed_at date,
    recommended_min integer,
    status public.timing_status DEFAULT 'none'::public.timing_status NOT NULL,
    dismissed_at_n integer DEFAULT 0 NOT NULL,
    approved_min integer,
    approved_by text,
    approved_at date,
    source text DEFAULT 'observed'::text NOT NULL
);

ALTER TABLE ONLY public.emp_timings FORCE ROW LEVEL SECURITY;


--
-- Name: employee_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_locations (
    tenant_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    location_id uuid NOT NULL
);

ALTER TABLE ONLY public.employee_locations FORCE ROW LEVEL SECURITY;


--
-- Name: employee_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_skills (
    tenant_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    service_id uuid NOT NULL
);

ALTER TABLE ONLY public.employee_skills FORCE ROW LEVEL SECURITY;


--
-- Name: employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    role_title text DEFAULT ''::text NOT NULL,
    email text NOT NULL,
    phone text,
    access public.employee_access DEFAULT 'staff'::public.employee_access NOT NULL,
    role_id uuid,
    bookable boolean DEFAULT false NOT NULL,
    status public.employee_status DEFAULT 'invited'::public.employee_status NOT NULL,
    twofa_enabled boolean DEFAULT false NOT NULL,
    color text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    hours jsonb,
    lang text DEFAULT 'en'::text NOT NULL
);

ALTER TABLE ONLY public.employees FORCE ROW LEVEL SECURITY;


--
-- Name: gift_cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gift_cards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    code text NOT NULL,
    value integer NOT NULL,
    remaining integer NOT NULL,
    customer_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT gift_cards_remaining_check CHECK ((remaining >= 0))
);

ALTER TABLE ONLY public.gift_cards FORCE ROW LEVEL SECURITY;


--
-- Name: holds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.holds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    key text NOT NULL,
    location_id uuid NOT NULL,
    date date NOT NULL,
    start_min integer NOT NULL,
    employee_id uuid,
    service_id uuid,
    until timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.holds FORCE ROW LEVEL SECURITY;


--
-- Name: holiday_calendar_years; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.holiday_calendar_years (
    country_code text NOT NULL,
    country_name text NOT NULL,
    year integer NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    source text DEFAULT ''::text NOT NULL
);

ALTER TABLE ONLY public.holiday_calendar_years FORCE ROW LEVEL SECURITY;


--
-- Name: holidays; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.holidays (
    id text NOT NULL,
    country_code text NOT NULL,
    year integer NOT NULL,
    date date NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    applies text DEFAULT 'Everyone'::text NOT NULL,
    moved_from date
);

ALTER TABLE ONLY public.holidays FORCE ROW LEVEL SECURITY;


--
-- Name: hq_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hq_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    role text DEFAULT 'hq_support'::text NOT NULL,
    password_hash text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hq_users_role_check CHECK ((role = ANY (ARRAY['hq_super'::text, 'hq_onboard'::text, 'hq_support'::text, 'hq_tech'::text, 'hq_audit'::text]))),
    CONSTRAINT hq_users_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text])))
);

ALTER TABLE ONLY public.hq_users FORCE ROW LEVEL SECURITY;


--
-- Name: integration_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integration_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    widget_id uuid,
    level text DEFAULT 'error'::text NOT NULL,
    code text NOT NULL,
    msg text NOT NULL,
    fix text DEFAULT ''::text NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.integration_events FORCE ROW LEVEL SECURITY;


--
-- Name: invoice_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_counters (
    tenant_id uuid NOT NULL,
    location_id uuid NOT NULL,
    next integer DEFAULT 1 NOT NULL
);

ALTER TABLE ONLY public.invoice_counters FORCE ROW LEVEL SECURITY;


--
-- Name: invoice_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    description text NOT NULL,
    qty integer DEFAULT 1 NOT NULL,
    unit_price integer NOT NULL,
    line_discount integer DEFAULT 0 NOT NULL,
    item_class text DEFAULT 'other'::text NOT NULL,
    service_id uuid,
    product_id uuid,
    appointment_id uuid,
    vat integer DEFAULT 18 NOT NULL,
    sort integer DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.invoice_lines FORCE ROW LEVEL SECURITY;


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    location_id uuid NOT NULL,
    number text NOT NULL,
    date date DEFAULT now() NOT NULL,
    customer_id uuid,
    customer_name text DEFAULT 'Walk-in'::text NOT NULL,
    employee_id uuid,
    employee_name text DEFAULT ''::text NOT NULL,
    method text NOT NULL,
    status public.invoice_status DEFAULT 'Paid'::public.invoice_status NOT NULL,
    total integer NOT NULL,
    tip integer DEFAULT 0 NOT NULL,
    service_charge integer DEFAULT 0 NOT NULL,
    cart_discount integer DEFAULT 0 NOT NULL,
    points_redeemed integer DEFAULT 0 NOT NULL,
    gift_amount integer DEFAULT 0 NOT NULL,
    promo_code text,
    promo_amount integer DEFAULT 0 NOT NULL,
    idempotency_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.invoices FORCE ROW LEVEL SECURITY;


--
-- Name: last_minute_offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.last_minute_offers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    location_id uuid NOT NULL,
    date date NOT NULL,
    slot_ids text[] NOT NULL,
    slots jsonb NOT NULL,
    eligible_variant_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    phases jsonb NOT NULL,
    status text DEFAULT 'live'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT last_minute_offers_status_check CHECK ((status = ANY (ARRAY['live'::text, 'ended'::text])))
);

ALTER TABLE ONLY public.last_minute_offers FORCE ROW LEVEL SECURITY;


--
-- Name: legal_entities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.legal_entities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    owner_type public.legal_entity_owner NOT NULL,
    owner_id uuid,
    is_default boolean DEFAULT false NOT NULL,
    name text NOT NULL,
    tax_id text,
    vat_reg text,
    currency text DEFAULT 'MKD'::text NOT NULL,
    status public.legal_entity_status DEFAULT 'pending'::public.legal_entity_status NOT NULL,
    fiscal_profile_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT salon_entities_have_tenant CHECK (((owner_type <> 'salon'::public.legal_entity_owner) OR (tenant_id IS NOT NULL)))
);

ALTER TABLE ONLY public.legal_entities FORCE ROW LEVEL SECURITY;


--
-- Name: legal_entity_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.legal_entity_locations (
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    location_id uuid NOT NULL
);

ALTER TABLE ONLY public.legal_entity_locations FORCE ROW LEVEL SECURITY;


--
-- Name: location_catalog_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.location_catalog_products (
    tenant_id uuid NOT NULL,
    location_id uuid NOT NULL,
    product_id uuid NOT NULL,
    active boolean DEFAULT true NOT NULL,
    price integer NOT NULL,
    low_stock integer DEFAULT 2 NOT NULL,
    pos boolean DEFAULT true NOT NULL,
    stock integer DEFAULT 0 NOT NULL,
    opened_amount integer DEFAULT 0 NOT NULL,
    CONSTRAINT location_catalog_products_stock_check CHECK ((stock >= 0))
);

ALTER TABLE ONLY public.location_catalog_products FORCE ROW LEVEL SECURITY;


--
-- Name: location_catalog_services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.location_catalog_services (
    tenant_id uuid NOT NULL,
    location_id uuid NOT NULL,
    service_id uuid NOT NULL,
    active boolean DEFAULT true NOT NULL,
    price integer NOT NULL,
    duration_min integer NOT NULL,
    online boolean DEFAULT true NOT NULL,
    pos boolean DEFAULT true NOT NULL,
    prep_min integer,
    reset_min integer
);

ALTER TABLE ONLY public.location_catalog_services FORCE ROW LEVEL SECURITY;


--
-- Name: location_catalog_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.location_catalog_variants (
    tenant_id uuid NOT NULL,
    location_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    active boolean DEFAULT true NOT NULL,
    price integer,
    duration_min integer
);

ALTER TABLE ONLY public.location_catalog_variants FORCE ROW LEVEL SECURITY;


--
-- Name: location_lifecycle_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.location_lifecycle_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    location_id uuid NOT NULL,
    from_state public.location_lifecycle NOT NULL,
    to_state public.location_lifecycle NOT NULL,
    actor_employee_id uuid,
    reason text,
    at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.location_lifecycle_log FORCE ROW LEVEL SECURITY;


--
-- Name: locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    city text,
    address text,
    tz text DEFAULT 'Europe/Skopje'::text NOT NULL,
    phone text,
    rooms integer DEFAULT 1 NOT NULL,
    inv_prefix text,
    online boolean DEFAULT false NOT NULL,
    cancel_hours integer DEFAULT 24 NOT NULL,
    opened date,
    hours jsonb,
    payments jsonb,
    lifecycle public.location_lifecycle DEFAULT 'DRAFT'::public.location_lifecycle NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    zip text,
    country text DEFAULT 'North Macedonia'::text NOT NULL
);

ALTER TABLE ONLY public.locations FORCE ROW LEVEL SECURITY;


--
-- Name: loyalty_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_config (
    tenant_id uuid NOT NULL,
    active boolean DEFAULT true NOT NULL,
    earn_per integer DEFAULT 60 NOT NULL,
    points integer DEFAULT 1 NOT NULL,
    step integer DEFAULT 100 NOT NULL,
    worth integer DEFAULT 300 NOT NULL,
    expiry_months integer DEFAULT 24 NOT NULL,
    welcome integer DEFAULT 25 NOT NULL,
    birthday integer DEFAULT 50 NOT NULL
);

ALTER TABLE ONLY public.loyalty_config FORCE ROW LEVEL SECURITY;


--
-- Name: loyalty_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    at date DEFAULT now() NOT NULL,
    reason text NOT NULL,
    points integer NOT NULL,
    ref text DEFAULT '—'::text NOT NULL
);

ALTER TABLE ONLY public.loyalty_ledger FORCE ROW LEVEL SECURITY;


--
-- Name: member_recs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_recs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    location_id uuid NOT NULL,
    date date NOT NULL,
    start_at text NOT NULL,
    end_at text NOT NULL,
    service_id uuid NOT NULL,
    employee_id uuid,
    normal_price integer NOT NULL,
    rec_pct integer NOT NULL,
    rec_price integer NOT NULL,
    candidates jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    offer_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    variant_id uuid,
    CONSTRAINT member_recs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'declined'::text])))
);

ALTER TABLE ONLY public.member_recs FORCE ROW LEVEL SECURITY;


--
-- Name: merchant_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchant_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    checkout_id uuid NOT NULL,
    payment_account_id uuid,
    legal_entity_id uuid,
    amount integer NOT NULL,
    method text NOT NULL,
    status public.mtx_status NOT NULL,
    provider_ref text,
    legal_doc_ref text,
    idempotency_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.merchant_transactions FORCE ROW LEVEL SECURITY;


--
-- Name: payment_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    legal_entity_id uuid NOT NULL,
    provider text,
    merchant_id text,
    settlement_ref text,
    status public.payment_account_status DEFAULT 'incomplete'::public.payment_account_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.payment_accounts FORCE ROW LEVEL SECURITY;


--
-- Name: personal_offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.personal_offers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    service_id uuid NOT NULL,
    variant_id uuid,
    location_id uuid NOT NULL,
    special_price integer NOT NULL,
    normal_price integer NOT NULL,
    valid_until date NOT NULL,
    intent text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'live'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT personal_offers_special_price_check CHECK ((special_price >= 0)),
    CONSTRAINT personal_offers_status_check CHECK ((status = ANY (ARRAY['live'::text, 'cancelled'::text, 'redeemed'::text])))
);

ALTER TABLE ONLY public.personal_offers FORCE ROW LEVEL SECURITY;


--
-- Name: premium_offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.premium_offers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    rec_id uuid,
    location_id uuid NOT NULL,
    date date NOT NULL,
    start_at text NOT NULL,
    end_at text NOT NULL,
    service_id uuid NOT NULL,
    employee_id uuid,
    normal_price integer NOT NULL,
    pct integer NOT NULL,
    price integer NOT NULL,
    candidates jsonb NOT NULL,
    stage integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'live'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    variant_id uuid,
    CONSTRAINT premium_offers_status_check CHECK ((status = ANY (ARRAY['live'::text, 'done'::text])))
);

ALTER TABLE ONLY public.premium_offers FORCE ROW LEVEL SECURITY;


--
-- Name: product_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    parent_id uuid,
    sort integer DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.product_categories FORCE ROW LEVEL SECURITY;


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    category_id uuid,
    sku text,
    price integer DEFAULT 0 NOT NULL,
    cost integer,
    vat integer DEFAULT 18 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    own boolean DEFAULT false NOT NULL,
    use text,
    size_amount integer,
    size_unit text,
    seller_legal_entity_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    supplier_product_id uuid
);

ALTER TABLE ONLY public.products FORCE ROW LEVEL SECURITY;


--
-- Name: purchase_order_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_order_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    order_id uuid NOT NULL,
    supplier_product_id uuid NOT NULL,
    qty integer NOT NULL,
    price integer NOT NULL,
    free integer DEFAULT 0 NOT NULL,
    recv integer DEFAULT 0 NOT NULL,
    dmg integer DEFAULT 0 NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    CONSTRAINT purchase_order_lines_qty_check CHECK ((qty > 0))
);

ALTER TABLE ONLY public.purchase_order_lines FORCE ROW LEVEL SECURITY;


--
-- Name: purchase_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    ref text NOT NULL,
    supplier_id uuid NOT NULL,
    location_id uuid NOT NULL,
    status public.purchase_order_status DEFAULT 'draft'::public.purchase_order_status NOT NULL,
    created_by uuid,
    by_name text DEFAULT ''::text NOT NULL,
    expected date,
    offer_id uuid,
    track text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.purchase_orders FORCE ROW LEVEL SECURITY;


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    token_hash text NOT NULL,
    family_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    rotated_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.refresh_tokens FORCE ROW LEVEL SECURITY;


--
-- Name: registrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.registrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    status public.registration_status DEFAULT 'pending_review'::public.registration_status NOT NULL,
    draft jsonb NOT NULL,
    email_token uuid DEFAULT gen_random_uuid() NOT NULL,
    email_sent_at timestamp with time zone,
    email_verified_at timestamp with time zone,
    resubmit_token uuid DEFAULT gen_random_uuid() NOT NULL,
    hq_reason text,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    business_id uuid,
    log jsonb DEFAULT '[]'::jsonb NOT NULL
);

ALTER TABLE ONLY public.registrations FORCE ROW LEVEL SECURITY;


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    std boolean DEFAULT false NOT NULL,
    locked boolean DEFAULT false NOT NULL,
    base_role_id uuid,
    description text DEFAULT ''::text NOT NULL,
    perms jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.roles FORCE ROW LEVEL SECURITY;


--
-- Name: schedule_exceptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_exceptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    location_id uuid NOT NULL,
    start_date date NOT NULL,
    end_date date,
    type public.schedule_exception_type NOT NULL,
    periods jsonb,
    reason text,
    source public.schedule_exception_source DEFAULT 'MANUAL'::public.schedule_exception_source NOT NULL,
    holiday_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.schedule_exceptions FORCE ROW LEVEL SECURITY;


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: service_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    parent_id uuid,
    sort integer DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.service_categories FORCE ROW LEVEL SECURITY;


--
-- Name: service_modifier_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_modifier_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    service_id uuid NOT NULL,
    name text NOT NULL,
    type public.modifier_group_type DEFAULT 'single'::public.modifier_group_type NOT NULL,
    required boolean DEFAULT false NOT NULL,
    sort integer DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.service_modifier_groups FORCE ROW LEVEL SECURITY;


--
-- Name: service_modifier_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_modifier_options (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    group_id uuid NOT NULL,
    name text NOT NULL,
    price integer DEFAULT 0 NOT NULL,
    duration_min integer DEFAULT 0 NOT NULL,
    sort integer DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.service_modifier_options FORCE ROW LEVEL SECURITY;


--
-- Name: service_recipes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_recipes (
    tenant_id uuid NOT NULL,
    service_id uuid NOT NULL,
    product_id uuid NOT NULL,
    qty_amount numeric(10,2) NOT NULL
);

ALTER TABLE ONLY public.service_recipes FORCE ROW LEVEL SECURITY;


--
-- Name: service_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_variants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    service_id uuid NOT NULL,
    label text NOT NULL,
    duration_min integer NOT NULL,
    price integer NOT NULL,
    std boolean DEFAULT false NOT NULL,
    sort integer DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.service_variants FORCE ROW LEVEL SECURITY;


--
-- Name: services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    category_id uuid,
    duration_min integer NOT NULL,
    price integer NOT NULL,
    vat integer DEFAULT 18 NOT NULL,
    status public.service_status DEFAULT 'active'::public.service_status NOT NULL,
    pos boolean DEFAULT true NOT NULL,
    online boolean DEFAULT true NOT NULL,
    prep_min integer,
    reset_min integer,
    sort integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.services FORCE ROW LEVEL SECURITY;


--
-- Name: stock_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    location_id uuid NOT NULL,
    product_id uuid NOT NULL,
    qty integer NOT NULL,
    kind public.stock_movement_kind NOT NULL,
    ref text,
    note text,
    actor_employee_id uuid,
    at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.stock_movements FORCE ROW LEVEL SECURITY;


--
-- Name: supplier_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_connections (
    tenant_id uuid NOT NULL,
    supplier_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    customer_no text DEFAULT ''::text NOT NULL,
    connected date,
    share jsonb DEFAULT '{}'::jsonb NOT NULL,
    location_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    CONSTRAINT supplier_connections_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'connected'::text, 'declined'::text])))
);

ALTER TABLE ONLY public.supplier_connections FORCE ROW LEVEL SECURITY;


--
-- Name: supplier_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_id uuid NOT NULL,
    brand text DEFAULT ''::text NOT NULL,
    name text NOT NULL,
    sku text DEFAULT ''::text NOT NULL,
    ean text DEFAULT ''::text NOT NULL,
    size text DEFAULT ''::text NOT NULL,
    pack integer DEFAULT 1 NOT NULL,
    buy integer DEFAULT 0 NOT NULL,
    rrp integer DEFAULT 0 NOT NULL,
    vat integer DEFAULT 18 NOT NULL,
    moq integer DEFAULT 1 NOT NULL,
    stock integer DEFAULT 0 NOT NULL,
    lead text DEFAULT ''::text NOT NULL,
    use text DEFAULT 'both'::text NOT NULL,
    category text DEFAULT ''::text NOT NULL,
    descr text DEFAULT ''::text NOT NULL,
    sample boolean DEFAULT false NOT NULL,
    own_size integer,
    own_unit text,
    active boolean DEFAULT true NOT NULL
);

ALTER TABLE ONLY public.supplier_products FORCE ROW LEVEL SECURITY;


--
-- Name: supplier_promotions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_promotions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_id uuid NOT NULL,
    brand text DEFAULT ''::text NOT NULL,
    title text NOT NULL,
    kind text DEFAULT 'pct'::text NOT NULL,
    product_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    starts date NOT NULL,
    ends date NOT NULL,
    min_order integer DEFAULT 0 NOT NULL,
    usage_limit integer DEFAULT 0 NOT NULL,
    terms text DEFAULT ''::text NOT NULL,
    audience text DEFAULT 'Connected salons only'::text NOT NULL,
    value integer DEFAULT 0 NOT NULL,
    per integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL
);

ALTER TABLE ONLY public.supplier_promotions FORCE ROW LEVEL SECURITY;


--
-- Name: supplier_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_id uuid NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    role text DEFAULT 'sr_account'::text NOT NULL,
    password_hash text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT supplier_users_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text])))
);

ALTER TABLE ONLY public.supplier_users FORCE ROW LEVEL SECURITY;


--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppliers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    type text DEFAULT 'Distributor'::text NOT NULL,
    territory text DEFAULT ''::text NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    min_order integer DEFAULT 0 NOT NULL,
    lead text DEFAULT ''::text NOT NULL,
    terms text DEFAULT ''::text NOT NULL,
    contact text DEFAULT ''::text NOT NULL,
    manager text DEFAULT ''::text NOT NULL,
    rating numeric(3,1),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.suppliers FORCE ROW LEVEL SECURITY;


--
-- Name: tax_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    legal_entity_id uuid,
    item_class text NOT NULL,
    tax_profile_id text
);

ALTER TABLE ONLY public.tax_rules FORCE ROW LEVEL SECURITY;


--
-- Name: user_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_credentials (
    employee_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    password_hash text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.user_credentials FORCE ROW LEVEL SECURITY;


--
-- Name: widgets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.widgets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    location_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    categories text[] DEFAULT '{all}'::text[] NOT NULL,
    lang text DEFAULT 'en'::text NOT NULL,
    theme text DEFAULT 'light'::text NOT NULL,
    btn_style text DEFAULT 'rounded'::text NOT NULL,
    cancel_policy text DEFAULT 'inherit'::text NOT NULL,
    accent text DEFAULT '#6f7357'::text NOT NULL,
    radius text DEFAULT '12'::text NOT NULL,
    start_step text DEFAULT 'location'::text NOT NULL,
    deposit text DEFAULT 'none'::text NOT NULL,
    status public.widget_status DEFAULT 'draft'::public.widget_status NOT NULL,
    domains text[] DEFAULT '{}'::text[] NOT NULL,
    publishable_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.widgets FORCE ROW LEVEL SECURITY;


--
-- Name: appointment_history appointment_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_history
    ADD CONSTRAINT appointment_history_pkey PRIMARY KEY (id);


--
-- Name: appointments appointments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: businesses businesses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.businesses
    ADD CONSTRAINT businesses_pkey PRIMARY KEY (id);


--
-- Name: businesses businesses_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.businesses
    ADD CONSTRAINT businesses_slug_key UNIQUE (slug);


--
-- Name: checkout_items checkout_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkout_items
    ADD CONSTRAINT checkout_items_pkey PRIMARY KEY (id);


--
-- Name: checkouts checkouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkouts
    ADD CONSTRAINT checkouts_pkey PRIMARY KEY (id);


--
-- Name: customer_activity customer_activity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_activity
    ADD CONSTRAINT customer_activity_pkey PRIMARY KEY (id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: discount_codes discount_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discount_codes
    ADD CONSTRAINT discount_codes_pkey PRIMARY KEY (id);


--
-- Name: discount_codes discount_codes_tenant_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discount_codes
    ADD CONSTRAINT discount_codes_tenant_id_code_key UNIQUE (tenant_id, code);


--
-- Name: emp_timings emp_timings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emp_timings
    ADD CONSTRAINT emp_timings_pkey PRIMARY KEY (id);


--
-- Name: emp_timings emp_timings_tenant_id_employee_id_service_id_variant_id_loc_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emp_timings
    ADD CONSTRAINT emp_timings_tenant_id_employee_id_service_id_variant_id_loc_key UNIQUE NULLS NOT DISTINCT (tenant_id, employee_id, service_id, variant_id, location_id);


--
-- Name: employee_locations employee_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_locations
    ADD CONSTRAINT employee_locations_pkey PRIMARY KEY (employee_id, location_id);


--
-- Name: employee_skills employee_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_skills
    ADD CONSTRAINT employee_skills_pkey PRIMARY KEY (employee_id, service_id);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- Name: gift_cards gift_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gift_cards
    ADD CONSTRAINT gift_cards_pkey PRIMARY KEY (id);


--
-- Name: gift_cards gift_cards_tenant_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gift_cards
    ADD CONSTRAINT gift_cards_tenant_id_code_key UNIQUE (tenant_id, code);


--
-- Name: holds holds_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holds
    ADD CONSTRAINT holds_key_key UNIQUE (key);


--
-- Name: holds holds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holds
    ADD CONSTRAINT holds_pkey PRIMARY KEY (id);


--
-- Name: holiday_calendar_years holiday_calendar_years_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holiday_calendar_years
    ADD CONSTRAINT holiday_calendar_years_pkey PRIMARY KEY (country_code, year);


--
-- Name: holidays holidays_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holidays
    ADD CONSTRAINT holidays_pkey PRIMARY KEY (id);


--
-- Name: hq_users hq_users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hq_users
    ADD CONSTRAINT hq_users_email_key UNIQUE (email);


--
-- Name: hq_users hq_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hq_users
    ADD CONSTRAINT hq_users_pkey PRIMARY KEY (id);


--
-- Name: integration_events integration_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_events
    ADD CONSTRAINT integration_events_pkey PRIMARY KEY (id);


--
-- Name: invoice_counters invoice_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_counters
    ADD CONSTRAINT invoice_counters_pkey PRIMARY KEY (location_id);


--
-- Name: invoice_lines invoice_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_lines
    ADD CONSTRAINT invoice_lines_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_tenant_id_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_tenant_id_number_key UNIQUE (tenant_id, number);


--
-- Name: last_minute_offers last_minute_offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.last_minute_offers
    ADD CONSTRAINT last_minute_offers_pkey PRIMARY KEY (id);


--
-- Name: legal_entities legal_entities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_entities
    ADD CONSTRAINT legal_entities_pkey PRIMARY KEY (id);


--
-- Name: legal_entity_locations legal_entity_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_entity_locations
    ADD CONSTRAINT legal_entity_locations_pkey PRIMARY KEY (legal_entity_id, location_id);


--
-- Name: location_catalog_products location_catalog_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_catalog_products
    ADD CONSTRAINT location_catalog_products_pkey PRIMARY KEY (location_id, product_id);


--
-- Name: location_catalog_services location_catalog_services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_catalog_services
    ADD CONSTRAINT location_catalog_services_pkey PRIMARY KEY (location_id, service_id);


--
-- Name: location_catalog_variants location_catalog_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_catalog_variants
    ADD CONSTRAINT location_catalog_variants_pkey PRIMARY KEY (location_id, variant_id);


--
-- Name: location_lifecycle_log location_lifecycle_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_lifecycle_log
    ADD CONSTRAINT location_lifecycle_log_pkey PRIMARY KEY (id);


--
-- Name: locations locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_pkey PRIMARY KEY (id);


--
-- Name: loyalty_config loyalty_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_config
    ADD CONSTRAINT loyalty_config_pkey PRIMARY KEY (tenant_id);


--
-- Name: loyalty_ledger loyalty_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_ledger
    ADD CONSTRAINT loyalty_ledger_pkey PRIMARY KEY (id);


--
-- Name: member_recs member_recs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_recs
    ADD CONSTRAINT member_recs_pkey PRIMARY KEY (id);


--
-- Name: merchant_transactions merchant_transactions_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_transactions
    ADD CONSTRAINT merchant_transactions_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: merchant_transactions merchant_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_transactions
    ADD CONSTRAINT merchant_transactions_pkey PRIMARY KEY (id);


--
-- Name: payment_accounts payment_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_accounts
    ADD CONSTRAINT payment_accounts_pkey PRIMARY KEY (id);


--
-- Name: personal_offers personal_offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_offers
    ADD CONSTRAINT personal_offers_pkey PRIMARY KEY (id);


--
-- Name: premium_offers premium_offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_offers
    ADD CONSTRAINT premium_offers_pkey PRIMARY KEY (id);


--
-- Name: product_categories product_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT product_categories_pkey PRIMARY KEY (id);


--
-- Name: product_categories product_categories_tenant_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT product_categories_tenant_id_name_key UNIQUE (tenant_id, name);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: purchase_order_lines purchase_order_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_lines
    ADD CONSTRAINT purchase_order_lines_pkey PRIMARY KEY (id);


--
-- Name: purchase_orders purchase_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: registrations registrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registrations
    ADD CONSTRAINT registrations_pkey PRIMARY KEY (id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: roles roles_tenant_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_tenant_id_name_key UNIQUE (tenant_id, name);


--
-- Name: schedule_exceptions schedule_exceptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_exceptions
    ADD CONSTRAINT schedule_exceptions_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: service_categories service_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_categories
    ADD CONSTRAINT service_categories_pkey PRIMARY KEY (id);


--
-- Name: service_categories service_categories_tenant_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_categories
    ADD CONSTRAINT service_categories_tenant_id_name_key UNIQUE (tenant_id, name);


--
-- Name: service_modifier_groups service_modifier_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_modifier_groups
    ADD CONSTRAINT service_modifier_groups_pkey PRIMARY KEY (id);


--
-- Name: service_modifier_options service_modifier_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_modifier_options
    ADD CONSTRAINT service_modifier_options_pkey PRIMARY KEY (id);


--
-- Name: service_recipes service_recipes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_recipes
    ADD CONSTRAINT service_recipes_pkey PRIMARY KEY (service_id, product_id);


--
-- Name: service_variants service_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_variants
    ADD CONSTRAINT service_variants_pkey PRIMARY KEY (id);


--
-- Name: services services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_pkey PRIMARY KEY (id);


--
-- Name: stock_movements stock_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_pkey PRIMARY KEY (id);


--
-- Name: supplier_connections supplier_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_connections
    ADD CONSTRAINT supplier_connections_pkey PRIMARY KEY (tenant_id, supplier_id);


--
-- Name: supplier_products supplier_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_products
    ADD CONSTRAINT supplier_products_pkey PRIMARY KEY (id);


--
-- Name: supplier_promotions supplier_promotions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_promotions
    ADD CONSTRAINT supplier_promotions_pkey PRIMARY KEY (id);


--
-- Name: supplier_users supplier_users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_users
    ADD CONSTRAINT supplier_users_email_key UNIQUE (email);


--
-- Name: supplier_users supplier_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_users
    ADD CONSTRAINT supplier_users_pkey PRIMARY KEY (id);


--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);


--
-- Name: tax_rules tax_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_rules
    ADD CONSTRAINT tax_rules_pkey PRIMARY KEY (id);


--
-- Name: user_credentials user_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_credentials
    ADD CONSTRAINT user_credentials_pkey PRIMARY KEY (employee_id);


--
-- Name: widgets widgets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.widgets
    ADD CONSTRAINT widgets_pkey PRIMARY KEY (id);


--
-- Name: widgets widgets_publishable_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.widgets
    ADD CONSTRAINT widgets_publishable_key_key UNIQUE (publishable_key);


--
-- Name: appointment_history_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_history_tenant ON public.appointment_history USING btree (tenant_id, appointment_id, at);


--
-- Name: appointments_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_day ON public.appointments USING btree (tenant_id, location_id, date);


--
-- Name: appointments_emp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_emp ON public.appointments USING btree (tenant_id, employee_id, date);


--
-- Name: appointments_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX appointments_idempotency ON public.appointments USING btree (tenant_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: appointments_widget_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_widget_idx ON public.appointments USING btree (widget_id) WHERE (widget_id IS NOT NULL);


--
-- Name: audit_log_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_tenant ON public.audit_log USING btree (tenant_id, ts DESC);


--
-- Name: checkout_items_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checkout_items_tenant ON public.checkout_items USING btree (tenant_id, checkout_id);


--
-- Name: checkouts_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checkouts_tenant ON public.checkouts USING btree (tenant_id, ts DESC);


--
-- Name: customer_activity_cust; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_activity_cust ON public.customer_activity USING btree (customer_id, ts DESC);


--
-- Name: customers_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customers_contact ON public.customers USING btree (tenant_id, phone, email);


--
-- Name: customers_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customers_tenant ON public.customers USING btree (tenant_id, name);


--
-- Name: emp_timings_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX emp_timings_tenant ON public.emp_timings USING btree (tenant_id, status);


--
-- Name: employee_locations_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_locations_tenant ON public.employee_locations USING btree (tenant_id, location_id);


--
-- Name: employee_skills_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_skills_tenant ON public.employee_skills USING btree (tenant_id, service_id);


--
-- Name: employees_email_global; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX employees_email_global ON public.employees USING btree (lower(email));


--
-- Name: employees_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employees_tenant ON public.employees USING btree (tenant_id, status);


--
-- Name: holds_slot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX holds_slot ON public.holds USING btree (tenant_id, location_id, date, start_min);


--
-- Name: holidays_country; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX holidays_country ON public.holidays USING btree (country_code, year, date);


--
-- Name: integration_events_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX integration_events_tenant ON public.integration_events USING btree (tenant_id, ts DESC);


--
-- Name: invoice_lines_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoice_lines_tenant ON public.invoice_lines USING btree (tenant_id, invoice_id);


--
-- Name: invoices_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX invoices_idempotency ON public.invoices USING btree (tenant_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: invoices_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoices_tenant ON public.invoices USING btree (tenant_id, location_id, date DESC);


--
-- Name: last_minute_offers_loc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX last_minute_offers_loc ON public.last_minute_offers USING btree (location_id, date, status);


--
-- Name: legal_entities_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX legal_entities_tenant ON public.legal_entities USING btree (tenant_id, status);


--
-- Name: legal_entity_locations_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX legal_entity_locations_tenant ON public.legal_entity_locations USING btree (tenant_id, location_id);


--
-- Name: loc_lifecycle_log_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX loc_lifecycle_log_tenant ON public.location_lifecycle_log USING btree (tenant_id, location_id, at);


--
-- Name: location_catalog_products_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX location_catalog_products_tenant ON public.location_catalog_products USING btree (tenant_id, location_id, active);


--
-- Name: location_catalog_services_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX location_catalog_services_tenant ON public.location_catalog_services USING btree (tenant_id, location_id, active);


--
-- Name: location_catalog_variants_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX location_catalog_variants_tenant ON public.location_catalog_variants USING btree (tenant_id, location_id);


--
-- Name: locations_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX locations_tenant ON public.locations USING btree (tenant_id, lifecycle);


--
-- Name: loyalty_ledger_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX loyalty_ledger_tenant ON public.loyalty_ledger USING btree (tenant_id, customer_id, at);


--
-- Name: merchant_transactions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX merchant_transactions_tenant ON public.merchant_transactions USING btree (tenant_id, checkout_id);


--
-- Name: payment_accounts_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_accounts_tenant ON public.payment_accounts USING btree (tenant_id, legal_entity_id);


--
-- Name: personal_offers_cust; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX personal_offers_cust ON public.personal_offers USING btree (customer_id, status);


--
-- Name: product_categories_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_categories_tenant ON public.product_categories USING btree (tenant_id, sort);


--
-- Name: products_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_tenant ON public.products USING btree (tenant_id, active);


--
-- Name: purchase_order_lines_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchase_order_lines_order ON public.purchase_order_lines USING btree (order_id);


--
-- Name: purchase_orders_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchase_orders_supplier ON public.purchase_orders USING btree (supplier_id, status);


--
-- Name: purchase_orders_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchase_orders_tenant ON public.purchase_orders USING btree (tenant_id, status);


--
-- Name: refresh_tokens_family; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX refresh_tokens_family ON public.refresh_tokens USING btree (tenant_id, family_id);


--
-- Name: registrations_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX registrations_queue ON public.registrations USING btree (status, ts DESC);


--
-- Name: schedule_exceptions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX schedule_exceptions_tenant ON public.schedule_exceptions USING btree (tenant_id, location_id, start_date);


--
-- Name: service_categories_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_categories_tenant ON public.service_categories USING btree (tenant_id, sort);


--
-- Name: service_modifier_groups_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_modifier_groups_tenant ON public.service_modifier_groups USING btree (tenant_id, service_id, sort);


--
-- Name: service_modifier_options_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_modifier_options_tenant ON public.service_modifier_options USING btree (tenant_id, group_id, sort);


--
-- Name: service_recipes_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_recipes_tenant ON public.service_recipes USING btree (tenant_id, product_id);


--
-- Name: service_variants_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_variants_tenant ON public.service_variants USING btree (tenant_id, service_id, sort);


--
-- Name: services_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX services_tenant ON public.services USING btree (tenant_id, status, sort);


--
-- Name: stock_movements_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_movements_tenant ON public.stock_movements USING btree (tenant_id, location_id, product_id, at);


--
-- Name: widgets_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX widgets_tenant ON public.widgets USING btree (tenant_id, status);


--
-- Name: appointment_history appointment_history_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_history
    ADD CONSTRAINT appointment_history_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE CASCADE;


--
-- Name: appointment_history appointment_history_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_history
    ADD CONSTRAINT appointment_history_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: appointments appointments_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: appointments appointments_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- Name: appointments appointments_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id);


--
-- Name: appointments appointments_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id);


--
-- Name: appointments appointments_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: appointments appointments_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.service_variants(id);


--
-- Name: appointments appointments_widget_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_widget_fk FOREIGN KEY (widget_id) REFERENCES public.widgets(id) ON DELETE SET NULL;


--
-- Name: audit_log audit_log_actor_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_actor_employee_id_fkey FOREIGN KEY (actor_employee_id) REFERENCES public.employees(id);


--
-- Name: audit_log audit_log_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: businesses businesses_owner_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.businesses
    ADD CONSTRAINT businesses_owner_fk FOREIGN KEY (owner_employee_id) REFERENCES public.employees(id);


--
-- Name: checkout_items checkout_items_checkout_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkout_items
    ADD CONSTRAINT checkout_items_checkout_id_fkey FOREIGN KEY (checkout_id) REFERENCES public.checkouts(id) ON DELETE CASCADE;


--
-- Name: checkout_items checkout_items_merchant_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkout_items
    ADD CONSTRAINT checkout_items_merchant_transaction_id_fkey FOREIGN KEY (merchant_transaction_id) REFERENCES public.merchant_transactions(id);


--
-- Name: checkout_items checkout_items_seller_legal_entity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkout_items
    ADD CONSTRAINT checkout_items_seller_legal_entity_id_fkey FOREIGN KEY (seller_legal_entity_id) REFERENCES public.legal_entities(id);


--
-- Name: checkout_items checkout_items_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkout_items
    ADD CONSTRAINT checkout_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: checkouts checkouts_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkouts
    ADD CONSTRAINT checkouts_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: checkouts checkouts_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkouts
    ADD CONSTRAINT checkouts_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id);


--
-- Name: checkouts checkouts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkouts
    ADD CONSTRAINT checkouts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: customer_activity customer_activity_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_activity
    ADD CONSTRAINT customer_activity_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: customer_activity customer_activity_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_activity
    ADD CONSTRAINT customer_activity_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: customers customers_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: discount_codes discount_codes_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discount_codes
    ADD CONSTRAINT discount_codes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: emp_timings emp_timings_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emp_timings
    ADD CONSTRAINT emp_timings_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- Name: emp_timings emp_timings_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emp_timings
    ADD CONSTRAINT emp_timings_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id);


--
-- Name: emp_timings emp_timings_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emp_timings
    ADD CONSTRAINT emp_timings_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id);


--
-- Name: emp_timings emp_timings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emp_timings
    ADD CONSTRAINT emp_timings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: emp_timings emp_timings_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emp_timings
    ADD CONSTRAINT emp_timings_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.service_variants(id);


--
-- Name: employee_locations employee_locations_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_locations
    ADD CONSTRAINT employee_locations_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- Name: employee_locations employee_locations_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_locations
    ADD CONSTRAINT employee_locations_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id);


--
-- Name: employee_locations employee_locations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_locations
    ADD CONSTRAINT employee_locations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: employee_skills employee_skills_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_skills
    ADD CONSTRAINT employee_skills_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_skills employee_skills_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_skills
    ADD CONSTRAINT employee_skills_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;


--
-- Name: employee_skills employee_skills_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_skills
    ADD CONSTRAINT employee_skills_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: employees employees_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id);


--
-- Name: employees employees_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: gift_cards gift_cards_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gift_cards
    ADD CONSTRAINT gift_cards_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: gift_cards gift_cards_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gift_cards
    ADD CONSTRAINT gift_cards_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: holds holds_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holds
    ADD CONSTRAINT holds_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- Name: holds holds_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holds
    ADD CONSTRAINT holds_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id);


--
-- Name: holds holds_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holds
    ADD CONSTRAINT holds_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id);


--
-- Name: holds holds_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holds
    ADD CONSTRAINT holds_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: holidays holidays_country_code_year_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holidays
    ADD CONSTRAINT holidays_country_code_year_fkey FOREIGN KEY (country_code, year) REFERENCES public.holiday_calendar_years(country_code, year);


--
-- Name: integration_events integration_events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_events
    ADD CONSTRAINT integration_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: integration_events integration_events_widget_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_events
    ADD CONSTRAINT integration_events_widget_id_fkey FOREIGN KEY (widget_id) REFERENCES public.widgets(id);


--
-- Name: invoice_counters invoice_counters_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_counters
    ADD CONSTRAINT invoice_counters_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id);


--
-- Name: invoice_counters invoice_counters_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_counters
    ADD CONSTRAINT invoice_counters_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: invoice_lines invoice_lines_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_lines
    ADD CONSTRAINT invoice_lines_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.appointments(id);


--
-- Name: invoice_lines invoice_lines_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_lines
    ADD CONSTRAINT invoice_lines_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: invoice_lines invoice_lines_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_lines
    ADD CONSTRAINT invoice_lines_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: invoice_lines invoice_lines_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_lines
    ADD CONSTRAINT invoice_lines_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id);


--
-- Name: invoice_lines invoice_lines_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_lines
    ADD CONSTRAINT invoice_lines_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: invoices invoices_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: invoices invoices_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- Name: invoices invoices_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id);


--
-- Name: invoices invoices_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: last_minute_offers last_minute_offers_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.last_minute_offers
    ADD CONSTRAINT last_minute_offers_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id);


--
-- Name: last_minute_offers last_minute_offers_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.last_minute_offers
    ADD CONSTRAINT last_minute_offers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: legal_entities legal_entities_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_entities
    ADD CONSTRAINT legal_entities_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: legal_entity_locations legal_entity_locations_legal_entity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_entity_locations
    ADD CONSTRAINT legal_entity_locations_legal_entity_id_fkey FOREIGN KEY (legal_entity_id) REFERENCES public.legal_entities(id);


--
-- Name: legal_entity_locations legal_entity_locations_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_entity_locations
    ADD CONSTRAINT legal_entity_locations_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id);


--
-- Name: legal_entity_locations legal_entity_locations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_entity_locations
    ADD CONSTRAINT legal_entity_locations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: location_catalog_products location_catalog_products_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_catalog_products
    ADD CONSTRAINT location_catalog_products_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id);


--
-- Name: location_catalog_products location_catalog_products_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_catalog_products
    ADD CONSTRAINT location_catalog_products_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: location_catalog_products location_catalog_products_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_catalog_products
    ADD CONSTRAINT location_catalog_products_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: location_catalog_services location_catalog_services_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_catalog_services
    ADD CONSTRAINT location_catalog_services_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id);


--
-- Name: location_catalog_services location_catalog_services_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_catalog_services
    ADD CONSTRAINT location_catalog_services_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;


--
-- Name: location_catalog_services location_catalog_services_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_catalog_services
    ADD CONSTRAINT location_catalog_services_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: location_catalog_variants location_catalog_variants_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_catalog_variants
    ADD CONSTRAINT location_catalog_variants_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id);


--
-- Name: location_catalog_variants location_catalog_variants_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_catalog_variants
    ADD CONSTRAINT location_catalog_variants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: location_catalog_variants location_catalog_variants_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_catalog_variants
    ADD CONSTRAINT location_catalog_variants_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.service_variants(id) ON DELETE CASCADE;


--
-- Name: location_lifecycle_log location_lifecycle_log_actor_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_lifecycle_log
    ADD CONSTRAINT location_lifecycle_log_actor_employee_id_fkey FOREIGN KEY (actor_employee_id) REFERENCES public.employees(id);


--
-- Name: location_lifecycle_log location_lifecycle_log_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_lifecycle_log
    ADD CONSTRAINT location_lifecycle_log_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id);


--
-- Name: location_lifecycle_log location_lifecycle_log_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_lifecycle_log
    ADD CONSTRAINT location_lifecycle_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: locations locations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: loyalty_config loyalty_config_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_config
    ADD CONSTRAINT loyalty_config_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: loyalty_ledger loyalty_ledger_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_ledger
    ADD CONSTRAINT loyalty_ledger_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: loyalty_ledger loyalty_ledger_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_ledger
    ADD CONSTRAINT loyalty_ledger_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: member_recs member_recs_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_recs
    ADD CONSTRAINT member_recs_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id);


--
-- Name: member_recs member_recs_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_recs
    ADD CONSTRAINT member_recs_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id);


--
-- Name: member_recs member_recs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_recs
    ADD CONSTRAINT member_recs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: merchant_transactions merchant_transactions_checkout_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_transactions
    ADD CONSTRAINT merchant_transactions_checkout_id_fkey FOREIGN KEY (checkout_id) REFERENCES public.checkouts(id) ON DELETE CASCADE;


--
-- Name: merchant_transactions merchant_transactions_legal_entity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_transactions
    ADD CONSTRAINT merchant_transactions_legal_entity_id_fkey FOREIGN KEY (legal_entity_id) REFERENCES public.legal_entities(id);


--
-- Name: merchant_transactions merchant_transactions_payment_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_transactions
    ADD CONSTRAINT merchant_transactions_payment_account_id_fkey FOREIGN KEY (payment_account_id) REFERENCES public.payment_accounts(id);


--
-- Name: merchant_transactions merchant_transactions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_transactions
    ADD CONSTRAINT merchant_transactions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: payment_accounts payment_accounts_legal_entity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_accounts
    ADD CONSTRAINT payment_accounts_legal_entity_id_fkey FOREIGN KEY (legal_entity_id) REFERENCES public.legal_entities(id);


--
-- Name: payment_accounts payment_accounts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_accounts
    ADD CONSTRAINT payment_accounts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: personal_offers personal_offers_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_offers
    ADD CONSTRAINT personal_offers_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: personal_offers personal_offers_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_offers
    ADD CONSTRAINT personal_offers_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id);


--
-- Name: personal_offers personal_offers_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_offers
    ADD CONSTRAINT personal_offers_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id);


--
-- Name: personal_offers personal_offers_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_offers
    ADD CONSTRAINT personal_offers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: personal_offers personal_offers_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_offers
    ADD CONSTRAINT personal_offers_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.service_variants(id);


--
-- Name: premium_offers premium_offers_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_offers
    ADD CONSTRAINT premium_offers_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id);


--
-- Name: premium_offers premium_offers_rec_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_offers
    ADD CONSTRAINT premium_offers_rec_id_fkey FOREIGN KEY (rec_id) REFERENCES public.member_recs(id);


--
-- Name: premium_offers premium_offers_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_offers
    ADD CONSTRAINT premium_offers_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id);


--
-- Name: premium_offers premium_offers_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_offers
    ADD CONSTRAINT premium_offers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: product_categories product_categories_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT product_categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.product_categories(id);


--
-- Name: product_categories product_categories_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT product_categories_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: products products_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.product_categories(id);


--
-- Name: products products_seller_legal_entity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_seller_legal_entity_id_fkey FOREIGN KEY (seller_legal_entity_id) REFERENCES public.legal_entities(id);


--
-- Name: products products_supplier_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_supplier_product_id_fkey FOREIGN KEY (supplier_product_id) REFERENCES public.supplier_products(id);


--
-- Name: products products_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: purchase_order_lines purchase_order_lines_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_lines
    ADD CONSTRAINT purchase_order_lines_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.purchase_orders(id);


--
-- Name: purchase_order_lines purchase_order_lines_supplier_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_lines
    ADD CONSTRAINT purchase_order_lines_supplier_product_id_fkey FOREIGN KEY (supplier_product_id) REFERENCES public.supplier_products(id);


--
-- Name: purchase_order_lines purchase_order_lines_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_lines
    ADD CONSTRAINT purchase_order_lines_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: purchase_orders purchase_orders_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id);


--
-- Name: purchase_orders purchase_orders_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: purchase_orders purchase_orders_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: refresh_tokens refresh_tokens_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- Name: refresh_tokens refresh_tokens_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: registrations registrations_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registrations
    ADD CONSTRAINT registrations_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id);


--
-- Name: roles roles_base_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_base_role_id_fkey FOREIGN KEY (base_role_id) REFERENCES public.roles(id);


--
-- Name: roles roles_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: schedule_exceptions schedule_exceptions_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_exceptions
    ADD CONSTRAINT schedule_exceptions_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id);


--
-- Name: schedule_exceptions schedule_exceptions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_exceptions
    ADD CONSTRAINT schedule_exceptions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: service_categories service_categories_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_categories
    ADD CONSTRAINT service_categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.service_categories(id);


--
-- Name: service_categories service_categories_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_categories
    ADD CONSTRAINT service_categories_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: service_modifier_groups service_modifier_groups_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_modifier_groups
    ADD CONSTRAINT service_modifier_groups_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;


--
-- Name: service_modifier_groups service_modifier_groups_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_modifier_groups
    ADD CONSTRAINT service_modifier_groups_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: service_modifier_options service_modifier_options_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_modifier_options
    ADD CONSTRAINT service_modifier_options_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.service_modifier_groups(id) ON DELETE CASCADE;


--
-- Name: service_modifier_options service_modifier_options_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_modifier_options
    ADD CONSTRAINT service_modifier_options_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: service_recipes service_recipes_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_recipes
    ADD CONSTRAINT service_recipes_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: service_recipes service_recipes_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_recipes
    ADD CONSTRAINT service_recipes_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;


--
-- Name: service_recipes service_recipes_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_recipes
    ADD CONSTRAINT service_recipes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: service_variants service_variants_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_variants
    ADD CONSTRAINT service_variants_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;


--
-- Name: service_variants service_variants_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_variants
    ADD CONSTRAINT service_variants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: services services_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.service_categories(id);


--
-- Name: services services_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: stock_movements stock_movements_actor_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_actor_employee_id_fkey FOREIGN KEY (actor_employee_id) REFERENCES public.employees(id);


--
-- Name: stock_movements stock_movements_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id);


--
-- Name: stock_movements stock_movements_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: stock_movements stock_movements_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: supplier_connections supplier_connections_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_connections
    ADD CONSTRAINT supplier_connections_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: supplier_connections supplier_connections_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_connections
    ADD CONSTRAINT supplier_connections_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: supplier_products supplier_products_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_products
    ADD CONSTRAINT supplier_products_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: supplier_promotions supplier_promotions_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_promotions
    ADD CONSTRAINT supplier_promotions_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: supplier_users supplier_users_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_users
    ADD CONSTRAINT supplier_users_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: tax_rules tax_rules_legal_entity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_rules
    ADD CONSTRAINT tax_rules_legal_entity_id_fkey FOREIGN KEY (legal_entity_id) REFERENCES public.legal_entities(id);


--
-- Name: tax_rules tax_rules_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_rules
    ADD CONSTRAINT tax_rules_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: user_credentials user_credentials_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_credentials
    ADD CONSTRAINT user_credentials_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- Name: user_credentials user_credentials_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_credentials
    ADD CONSTRAINT user_credentials_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: widgets widgets_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.widgets
    ADD CONSTRAINT widgets_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


--
-- Name: registrations applicant_by_token; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY applicant_by_token ON public.registrations FOR SELECT USING (((resubmit_token)::text = current_setting('app.reg_token'::text, true)));


--
-- Name: registrations applicant_resubmit; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY applicant_resubmit ON public.registrations FOR UPDATE USING (((resubmit_token)::text = current_setting('app.reg_token'::text, true))) WITH CHECK (((resubmit_token)::text = current_setting('app.reg_token'::text, true)));


--
-- Name: appointment_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.appointment_history ENABLE ROW LEVEL SECURITY;

--
-- Name: appointments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: employees auth_login_lookup; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_login_lookup ON public.employees FOR SELECT USING ((current_setting('app.auth'::text, true) = 'login'::text));


--
-- Name: user_credentials auth_login_lookup; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_login_lookup ON public.user_credentials FOR SELECT USING ((current_setting('app.auth'::text, true) = 'login'::text));


--
-- Name: businesses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;

--
-- Name: checkout_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.checkout_items ENABLE ROW LEVEL SECURITY;

--
-- Name: checkouts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.checkouts ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_activity; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_activity ENABLE ROW LEVEL SECURITY;

--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: discount_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.discount_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: emp_timings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.emp_timings ENABLE ROW LEVEL SECURITY;

--
-- Name: employee_locations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employee_locations ENABLE ROW LEVEL SECURITY;

--
-- Name: employee_skills; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employee_skills ENABLE ROW LEVEL SECURITY;

--
-- Name: employees; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

--
-- Name: gift_cards; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gift_cards ENABLE ROW LEVEL SECURITY;

--
-- Name: holds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.holds ENABLE ROW LEVEL SECURITY;

--
-- Name: holiday_calendar_years; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.holiday_calendar_years ENABLE ROW LEVEL SECURITY;

--
-- Name: holidays; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

--
-- Name: hq_users hq_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hq_all ON public.hq_users USING ((current_setting('app.hq'::text, true) = '1'::text)) WITH CHECK ((current_setting('app.hq'::text, true) = '1'::text));


--
-- Name: registrations hq_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hq_all ON public.registrations USING ((current_setting('app.hq'::text, true) = '1'::text)) WITH CHECK ((current_setting('app.hq'::text, true) = '1'::text));


--
-- Name: hq_users hq_login_lookup; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hq_login_lookup ON public.hq_users FOR SELECT USING ((current_setting('app.auth'::text, true) = 'login'::text));


--
-- Name: audit_log hq_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hq_read ON public.audit_log FOR SELECT USING ((current_setting('app.hq'::text, true) = '1'::text));


--
-- Name: businesses hq_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hq_read ON public.businesses FOR SELECT USING ((current_setting('app.hq'::text, true) = '1'::text));


--
-- Name: employees hq_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hq_read ON public.employees FOR SELECT USING ((current_setting('app.hq'::text, true) = '1'::text));


--
-- Name: legal_entities hq_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hq_read ON public.legal_entities FOR SELECT USING ((current_setting('app.hq'::text, true) = '1'::text));


--
-- Name: legal_entity_locations hq_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hq_read ON public.legal_entity_locations FOR SELECT USING ((current_setting('app.hq'::text, true) = '1'::text));


--
-- Name: location_lifecycle_log hq_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hq_read ON public.location_lifecycle_log FOR SELECT USING ((current_setting('app.hq'::text, true) = '1'::text));


--
-- Name: locations hq_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hq_read ON public.locations FOR SELECT USING ((current_setting('app.hq'::text, true) = '1'::text));


--
-- Name: payment_accounts hq_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hq_read ON public.payment_accounts FOR SELECT USING ((current_setting('app.hq'::text, true) = '1'::text));


--
-- Name: hq_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hq_users ENABLE ROW LEVEL SECURITY;

--
-- Name: integration_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.integration_events ENABLE ROW LEVEL SECURITY;

--
-- Name: invoice_counters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoice_counters ENABLE ROW LEVEL SECURITY;

--
-- Name: invoice_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: last_minute_offers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.last_minute_offers ENABLE ROW LEVEL SECURITY;

--
-- Name: legal_entities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.legal_entities ENABLE ROW LEVEL SECURITY;

--
-- Name: legal_entity_locations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.legal_entity_locations ENABLE ROW LEVEL SECURITY;

--
-- Name: location_catalog_products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.location_catalog_products ENABLE ROW LEVEL SECURITY;

--
-- Name: location_catalog_services; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.location_catalog_services ENABLE ROW LEVEL SECURITY;

--
-- Name: location_catalog_variants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.location_catalog_variants ENABLE ROW LEVEL SECURITY;

--
-- Name: location_lifecycle_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.location_lifecycle_log ENABLE ROW LEVEL SECURITY;

--
-- Name: locations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

--
-- Name: loyalty_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.loyalty_config ENABLE ROW LEVEL SECURITY;

--
-- Name: loyalty_ledger; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.loyalty_ledger ENABLE ROW LEVEL SECURITY;

--
-- Name: member_recs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_recs ENABLE ROW LEVEL SECURITY;

--
-- Name: merchant_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.merchant_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: personal_offers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.personal_offers ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_products platform_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_read ON public.supplier_products FOR SELECT USING (((current_setting('app.tenant_id'::text, true) IS NOT NULL) OR (current_setting('app.supplier_id'::text, true) IS NOT NULL) OR (current_setting('app.hq'::text, true) = '1'::text)));


--
-- Name: supplier_promotions platform_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_read ON public.supplier_promotions FOR SELECT USING (((current_setting('app.tenant_id'::text, true) IS NOT NULL) OR (current_setting('app.supplier_id'::text, true) IS NOT NULL)));


--
-- Name: suppliers platform_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_read ON public.suppliers FOR SELECT USING (((current_setting('app.tenant_id'::text, true) IS NOT NULL) OR (current_setting('app.supplier_id'::text, true) IS NOT NULL) OR (current_setting('app.hq'::text, true) = '1'::text)));


--
-- Name: premium_offers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.premium_offers ENABLE ROW LEVEL SECURITY;

--
-- Name: product_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

--
-- Name: registrations public_apply; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY public_apply ON public.registrations FOR INSERT WITH CHECK ((current_setting('app.public'::text, true) = '1'::text));


--
-- Name: widgets public_key_lookup; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY public_key_lookup ON public.widgets FOR SELECT USING ((current_setting('app.public'::text, true) = '1'::text));


--
-- Name: businesses public_slug_lookup; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY public_slug_lookup ON public.businesses FOR SELECT USING ((current_setting('app.public'::text, true) = '1'::text));


--
-- Name: purchase_order_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: purchase_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: holiday_calendar_years read_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_all ON public.holiday_calendar_years FOR SELECT USING (true);


--
-- Name: holidays read_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_all ON public.holidays FOR SELECT USING (true);


--
-- Name: refresh_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.refresh_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: registrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;

--
-- Name: roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

--
-- Name: schedule_exceptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schedule_exceptions ENABLE ROW LEVEL SECURITY;

--
-- Name: service_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: service_modifier_groups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_modifier_groups ENABLE ROW LEVEL SECURITY;

--
-- Name: service_modifier_options; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_modifier_options ENABLE ROW LEVEL SECURITY;

--
-- Name: service_recipes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_recipes ENABLE ROW LEVEL SECURITY;

--
-- Name: service_variants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_variants ENABLE ROW LEVEL SECURITY;

--
-- Name: services; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_movements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.supplier_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_connections supplier_decide; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY supplier_decide ON public.supplier_connections FOR UPDATE USING (((supplier_id)::text = current_setting('app.supplier_id'::text, true))) WITH CHECK (((supplier_id)::text = current_setting('app.supplier_id'::text, true)));


--
-- Name: supplier_users supplier_login_lookup; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY supplier_login_lookup ON public.supplier_users FOR SELECT USING ((current_setting('app.auth'::text, true) = 'login'::text));


--
-- Name: supplier_users supplier_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY supplier_own ON public.supplier_users USING (((supplier_id)::text = current_setting('app.supplier_id'::text, true))) WITH CHECK (((supplier_id)::text = current_setting('app.supplier_id'::text, true)));


--
-- Name: supplier_products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.supplier_products ENABLE ROW LEVEL SECURITY;

--
-- Name: purchase_orders supplier_progress; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY supplier_progress ON public.purchase_orders FOR UPDATE USING ((((supplier_id)::text = current_setting('app.supplier_id'::text, true)) AND (status <> 'draft'::public.purchase_order_status) AND (status <> 'approval'::public.purchase_order_status))) WITH CHECK (((supplier_id)::text = current_setting('app.supplier_id'::text, true)));


--
-- Name: supplier_promotions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.supplier_promotions ENABLE ROW LEVEL SECURITY;

--
-- Name: businesses supplier_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY supplier_read ON public.businesses FOR SELECT USING (((current_setting('app.supplier_id'::text, true) IS NOT NULL) AND (id IN ( SELECT supplier_connections.tenant_id
   FROM public.supplier_connections
  WHERE ((supplier_connections.supplier_id)::text = current_setting('app.supplier_id'::text, true))))));


--
-- Name: purchase_order_lines supplier_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY supplier_read ON public.purchase_order_lines FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.purchase_orders o
  WHERE ((o.id = purchase_order_lines.order_id) AND ((o.supplier_id)::text = current_setting('app.supplier_id'::text, true)) AND (o.status <> 'draft'::public.purchase_order_status) AND (o.status <> 'approval'::public.purchase_order_status)))));


--
-- Name: purchase_orders supplier_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY supplier_read ON public.purchase_orders FOR SELECT USING ((((supplier_id)::text = current_setting('app.supplier_id'::text, true)) AND (status <> 'draft'::public.purchase_order_status) AND (status <> 'approval'::public.purchase_order_status)));


--
-- Name: supplier_connections supplier_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY supplier_read ON public.supplier_connections FOR SELECT USING (((supplier_id)::text = current_setting('app.supplier_id'::text, true)));


--
-- Name: supplier_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.supplier_users ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_products supplier_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY supplier_write ON public.supplier_products USING (((supplier_id)::text = current_setting('app.supplier_id'::text, true))) WITH CHECK (((supplier_id)::text = current_setting('app.supplier_id'::text, true)));


--
-- Name: supplier_promotions supplier_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY supplier_write ON public.supplier_promotions USING (((supplier_id)::text = current_setting('app.supplier_id'::text, true))) WITH CHECK (((supplier_id)::text = current_setting('app.supplier_id'::text, true)));


--
-- Name: suppliers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

--
-- Name: tax_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tax_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log tenant_append; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_append ON public.audit_log FOR INSERT WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: customer_activity tenant_append; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_append ON public.customer_activity FOR INSERT WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: integration_events tenant_append; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_append ON public.integration_events FOR INSERT WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: loyalty_ledger tenant_append; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_append ON public.loyalty_ledger FOR INSERT WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: stock_movements tenant_append; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_append ON public.stock_movements FOR INSERT WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: appointment_history tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.appointment_history USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: appointments tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.appointments USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: businesses tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.businesses USING ((id = app.current_tenant())) WITH CHECK ((id = app.current_tenant()));


--
-- Name: checkout_items tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.checkout_items USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: checkouts tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.checkouts USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: customers tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.customers USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: discount_codes tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.discount_codes USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: emp_timings tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.emp_timings USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: employee_locations tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.employee_locations USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: employee_skills tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.employee_skills USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: employees tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.employees USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: gift_cards tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.gift_cards USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: holds tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.holds USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: invoice_counters tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.invoice_counters USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: invoice_lines tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.invoice_lines USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: invoices tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.invoices USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: last_minute_offers tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.last_minute_offers USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: legal_entities tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.legal_entities USING (((tenant_id = app.current_tenant()) OR (tenant_id IS NULL))) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: legal_entity_locations tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.legal_entity_locations USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: location_catalog_products tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.location_catalog_products USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: location_catalog_services tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.location_catalog_services USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: location_catalog_variants tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.location_catalog_variants USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: location_lifecycle_log tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.location_lifecycle_log USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: locations tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.locations USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: loyalty_config tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.loyalty_config USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: member_recs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.member_recs USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: merchant_transactions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.merchant_transactions USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: payment_accounts tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.payment_accounts USING (((tenant_id = app.current_tenant()) OR (tenant_id IS NULL))) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: personal_offers tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.personal_offers USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: premium_offers tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.premium_offers USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: product_categories tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.product_categories USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: products tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.products USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: purchase_order_lines tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.purchase_order_lines USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: purchase_orders tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.purchase_orders USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: roles tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.roles USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: schedule_exceptions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.schedule_exceptions USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: service_categories tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.service_categories USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: service_modifier_groups tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.service_modifier_groups USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: service_modifier_options tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.service_modifier_options USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: service_recipes tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.service_recipes USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: service_variants tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.service_variants USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: services tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.services USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: supplier_connections tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.supplier_connections USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: tax_rules tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.tax_rules USING (((tenant_id = app.current_tenant()) OR (tenant_id IS NULL))) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: user_credentials tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.user_credentials USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: widgets tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.widgets USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: audit_log tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_read ON public.audit_log FOR SELECT USING ((tenant_id = app.current_tenant()));


--
-- Name: customer_activity tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_read ON public.customer_activity FOR SELECT USING ((tenant_id = app.current_tenant()));


--
-- Name: integration_events tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_read ON public.integration_events FOR SELECT USING ((tenant_id = app.current_tenant()));


--
-- Name: loyalty_ledger tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_read ON public.loyalty_ledger FOR SELECT USING ((tenant_id = app.current_tenant()));


--
-- Name: stock_movements tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_read ON public.stock_movements FOR SELECT USING ((tenant_id = app.current_tenant()));


--
-- Name: refresh_tokens token_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY token_access ON public.refresh_tokens USING (true) WITH CHECK (true);


--
-- Name: user_credentials; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_credentials ENABLE ROW LEVEL SECURITY;

--
-- Name: widgets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict dbmate


--
-- Dbmate schema migrations
--

INSERT INTO public.schema_migrations (version) VALUES
    ('20260824120001'),
    ('20260824120002'),
    ('20260824120003'),
    ('20260824150004'),
    ('20260824150005'),
    ('20260824180006'),
    ('20260824180007'),
    ('20260824180008'),
    ('20260824210009'),
    ('20260825090010'),
    ('20260825170011'),
    ('20260825190012'),
    ('20260826090013'),
    ('20260826100014'),
    ('20260826110015'),
    ('20260826130016'),
    ('20260826150017'),
    ('20260826170018');
