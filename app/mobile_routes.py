"""Mobile v1.2 endpoints: classes, class summaries, schedule, profile picture, preferences, feedback."""

from datetime import datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, File, Query, Request, Response, UploadFile

from app import models as m
from app import schemas as s
from app.errors import fail
from app.mobile_service import (
    class_out,
    clean_avatar,
    ensure_profile,
    student_stats,
    summary,
    upsert_class,
)
from app.repository import Repo, check_revision
from app.routes import DB, Auth, Limit, Offset, UpdatedSince, changed_since

router = APIRouter(prefix="/v1")

FEEDBACK_PER_DAY = 20


def today_for(request: Request):
    # Class lists change on the server's calendar day (UTC); enrollments mostly start at the school year.
    return m.now().date()


# --- Classes --------------------------------------------------------------------------------


@router.put(
    "/classes/{class_id}",
    response_model=s.ClassOut,
    tags=["Classes"],
    description=(
        "Create or update a class (one section and subject) with its class list, idempotently. "
        "Grade level, section and subject are found or created by name. Students no longer listed have "
        "their enrollment closed, never deleted; their results are kept."
    ),
)
def class_put(class_id: UUID, payload: s.ClassIn, request: Request, user: Auth, db: DB):
    repo = Repo(db, user.id)
    return class_out(repo, upsert_class(repo, class_id, payload, today_for(request)))


@router.get("/classes", response_model=s.Page[s.ClassOut], tags=["Classes"])
def class_list(
    user: Auth,
    db: DB,
    limit: Limit = 50,
    offset: Offset = 0,
    updated_since: UpdatedSince = None,
    include_archived: Annotated[bool | None, Query(description="Defaults to true with updated_since")] = None,
):
    server_time = m.now()
    repo = Repo(db, user.id)
    filters = changed_since(m.TeachingClass, updated_since)
    # Incremental sync must also hear about archived classes so other devices can drop them.
    if not (include_archived if include_archived is not None else updated_since is not None):
        filters.append(m.TeachingClass.archived.is_(False))
    rows, more = repo.page(m.TeachingClass, limit, offset, *filters)
    return s.Page(
        items=[class_out(repo, c) for c in rows],
        limit=limit,
        offset=offset,
        has_more=more,
        server_time=server_time,
    )


@router.get("/classes/{class_id}", response_model=s.ClassOut, tags=["Classes"])
def class_get(class_id: UUID, user: Auth, db: DB):
    repo = Repo(db, user.id)
    return class_out(repo, repo.get(m.TeachingClass, class_id))


@router.delete(
    "/classes/{class_id}",
    response_model=s.ClassOut,
    tags=["Classes"],
    description="Archives the class. Its assessments, results and enrollments are kept. Idempotent.",
)
def class_archive(class_id: UUID, user: Auth, db: DB):
    repo = Repo(db, user.id)
    cls = repo.get(m.TeachingClass, class_id, lock=True)
    if not cls.archived:
        cls.archived = True
        cls.revision += 1
        db.flush()
    return class_out(repo, cls)


@router.get("/classes/{class_id}/summary", response_model=s.ClassSummary, tags=["Classes"])
def class_summary(class_id: UUID, user: Auth, db: DB, assessment_id: UUID | None = None):
    repo = Repo(db, user.id)
    return summary(repo, repo.get(m.TeachingClass, class_id), assessment_id)


@router.get("/classes/{class_id}/students", response_model=s.Page[s.StudentStat], tags=["Classes"])
def class_students(
    class_id: UUID,
    user: Auth,
    db: DB,
    assessment_id: UUID | None = None,
    sort: s.StudentSort = "-average",
):
    repo = Repo(db, user.id)
    items = student_stats(repo, repo.get(m.TeachingClass, class_id), assessment_id, sort)
    return s.Page(items=items, limit=len(items), offset=0, has_more=False)


# --- Schedule -------------------------------------------------------------------------------


def event_out(event: m.CalendarEvent) -> s.EventOut:
    out = s.EventOut.model_validate(event)
    return out.model_copy(
        update={"starts_at": s.as_utc(event.starts_at), "deleted_at": s.as_utc(event.deleted_at)}
    )


@router.put(
    "/events/{event_id}",
    response_model=s.EventOut,
    tags=["Schedule"],
    description="Create or update a schedule item idempotently. A deleted item comes back if saved again.",
)
def event_put(event_id: UUID, payload: s.EventIn, user: Auth, db: DB):
    repo = Repo(db, user.id)
    if payload.class_id and not repo.rows(m.TeachingClass, m.TeachingClass.id == payload.class_id):
        fail(422, "unknown_class", "Upload the class before schedule items that use it")
    if payload.assessment_id and not repo.rows(m.Assessment, m.Assessment.id == payload.assessment_id):
        fail(422, "unknown_assessment", "Upload the assessment before schedule items that use it")
    values = payload.model_dump(exclude={"expected_revision"})
    event = repo.db.scalar(
        repo.query(m.CalendarEvent).where(m.CalendarEvent.id == event_id).with_for_update()
    )
    if event is None:
        event = repo.add(m.CalendarEvent, id=event_id, **values)
    else:
        if payload.expected_revision:
            check_revision(event, payload.expected_revision)
        for name, value in values.items():
            setattr(event, name, value)
        event.deleted_at = None
        event.revision += 1
        db.flush()
    return event_out(event)


@router.get("/events", response_model=s.Page[s.EventOut], tags=["Schedule"])
def event_list(
    user: Auth,
    db: DB,
    limit: Limit = 100,
    offset: Offset = 0,
    starts_from: Annotated[datetime | None, Query(alias="from")] = None,
    starts_before: Annotated[datetime | None, Query(alias="to")] = None,
    updated_since: UpdatedSince = None,
):
    server_time = m.now()
    repo = Repo(db, user.id)
    filters = changed_since(m.CalendarEvent, updated_since)
    if updated_since is None:
        filters.append(m.CalendarEvent.deleted_at.is_(None))
    if starts_from or starts_before:
        if not (starts_from and starts_before):
            fail(422, "range_required", "Send both from and to")
        start, end = s.aware_utc(starts_from), s.aware_utc(starts_before)
        if end <= start or end - start > timedelta(days=93):
            fail(422, "invalid_range", "Use a range of up to 93 days")
        filters += [m.CalendarEvent.starts_at >= start, m.CalendarEvent.starts_at < end]
    rows, more = repo.page(m.CalendarEvent, limit, offset, *filters)
    return s.Page(
        items=[event_out(e) for e in rows], limit=limit, offset=offset, has_more=more, server_time=server_time
    )


@router.delete(
    "/events/{event_id}",
    response_model=s.EventOut,
    tags=["Schedule"],
    description="Soft delete: incremental sync returns it with deleted_at set. Idempotent.",
)
def event_delete(event_id: UUID, user: Auth, db: DB):
    event = Repo(db, user.id).get(m.CalendarEvent, event_id, lock=True)
    if event.deleted_at is None:
        event.deleted_at = m.now()
        event.revision += 1
        db.flush()
    return event_out(event)


# --- Profile picture and preferences ----------------------------------------------------------


@router.put(
    "/me/avatar",
    status_code=204,
    tags=["Authentication"],
    description="Upload a profile picture (JPEG/PNG/WebP, under 512 KB). Stored as a 256 px JPEG without metadata.",
)
def avatar_put(user: Auth, db: DB, file: UploadFile = File(...)):
    try:
        data = file.file.read(512 * 1024 + 1)
    finally:
        file.file.close()
    picture = clean_avatar(data, file.content_type)
    profile = ensure_profile(Repo(db, user.id), user.id)
    profile.avatar_image, profile.avatar_updated_at, profile.avatar_style = picture, m.now(), "photo"
    db.flush()
    return Response(status_code=204)


@router.get(
    "/me/avatar",
    tags=["Authentication"],
    responses={200: {"content": {"image/jpeg": {}}}},
    response_class=Response,
)
def avatar_get(user: Auth, db: DB):
    profile = db.scalar(Repo(db, user.id).query(m.Profile))
    if profile is None or profile.avatar_image is None:
        fail(404, "not_found", "No profile picture")
    return Response(
        profile.avatar_image, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=300"}
    )


@router.delete("/me/avatar", status_code=204, tags=["Authentication"])
def avatar_delete(user: Auth, db: DB):
    profile = db.scalar(Repo(db, user.id).query(m.Profile).with_for_update())
    if profile and profile.avatar_updated_at is not None:
        profile.avatar_image, profile.avatar_updated_at = None, None
        if profile.avatar_style == "photo":
            profile.avatar_style = "initials"
        db.flush()
    return Response(status_code=204)


def preferences_out(profile: m.Profile | None) -> s.PreferencesOut:
    stored = (profile.preferences if profile else None) or {}
    known = {name: stored[name] for name in s.Preferences.model_fields if name in stored}
    return s.PreferencesOut(**known, updated_at=s.as_utc(profile.preferences_updated_at) if profile else None)


@router.get("/me/preferences", response_model=s.PreferencesOut, tags=["Authentication"])
def preferences_get(user: Auth, db: DB):
    return preferences_out(db.scalar(Repo(db, user.id).query(m.Profile)))


@router.put(
    "/me/preferences",
    response_model=s.PreferencesOut,
    tags=["Authentication"],
    description="Merges the settings that are sent; others are unchanged.",
)
def preferences_put(payload: s.Preferences, user: Auth, db: DB):
    profile = ensure_profile(Repo(db, user.id), user.id)
    profile.preferences = {
        **(profile.preferences or {}),
        **payload.model_dump(exclude_unset=True, mode="json"),
    }
    profile.preferences_updated_at = m.now()
    db.flush()
    return preferences_out(profile)


# --- Feedback -------------------------------------------------------------------------------


@router.post("/feedback", response_model=s.FeedbackOut, status_code=201, tags=["Support"])
def feedback_create(payload: s.FeedbackIn, user: Auth, db: DB):
    repo = Repo(db, user.id)
    since = m.now() - timedelta(days=1)
    if len(repo.rows(m.Feedback, m.Feedback.created_at > since)) >= FEEDBACK_PER_DAY:
        fail(429, "feedback_limit", "Thanks! That's a lot of feedback today; try again tomorrow")
    record = repo.add(m.Feedback, **payload.model_dump())
    return s.FeedbackOut(id=record.id, created_at=s.as_utc(record.created_at))
