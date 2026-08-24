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
-- Name: payment_account_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_account_status AS ENUM (
    'active',
    'incomplete'
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
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.businesses FORCE ROW LEVEL SECURITY;


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
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.employees FORCE ROW LEVEL SECURITY;


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
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.locations FORCE ROW LEVEL SECURITY;


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
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.products FORCE ROW LEVEL SECURITY;


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
-- Name: payment_accounts payment_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_accounts
    ADD CONSTRAINT payment_accounts_pkey PRIMARY KEY (id);


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
-- Name: user_credentials user_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_credentials
    ADD CONSTRAINT user_credentials_pkey PRIMARY KEY (employee_id);


--
-- Name: audit_log_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_tenant ON public.audit_log USING btree (tenant_id, ts DESC);


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
-- Name: payment_accounts_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_accounts_tenant ON public.payment_accounts USING btree (tenant_id, legal_entity_id);


--
-- Name: product_categories_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_categories_tenant ON public.product_categories USING btree (tenant_id, sort);


--
-- Name: products_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_tenant ON public.products USING btree (tenant_id, active);


--
-- Name: refresh_tokens_family; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX refresh_tokens_family ON public.refresh_tokens USING btree (tenant_id, family_id);


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
-- Name: products products_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.businesses(id);


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
-- Name: payment_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: product_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

--
-- Name: refresh_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.refresh_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

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
-- Name: audit_log tenant_append; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_append ON public.audit_log FOR INSERT WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: stock_movements tenant_append; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_append ON public.stock_movements FOR INSERT WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: businesses tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.businesses USING ((id = app.current_tenant())) WITH CHECK ((id = app.current_tenant()));


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
-- Name: payment_accounts tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.payment_accounts USING (((tenant_id = app.current_tenant()) OR (tenant_id IS NULL))) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: product_categories tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.product_categories USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: products tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.products USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: roles tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.roles USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


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
-- Name: service_variants tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.service_variants USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: services tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.services USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: user_credentials tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.user_credentials USING ((tenant_id = app.current_tenant())) WITH CHECK ((tenant_id = app.current_tenant()));


--
-- Name: audit_log tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_read ON public.audit_log FOR SELECT USING ((tenant_id = app.current_tenant()));


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
    ('20260824150005');
