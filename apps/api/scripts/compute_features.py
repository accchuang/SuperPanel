from app.db.session import Base, SessionLocal, engine
from app.services.features import rebuild_features


if __name__ == "__main__":
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        count = rebuild_features(db)
        print(f"Rebuilt {count} feature rows")
    finally:
        db.close()
