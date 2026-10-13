"""
Non-régression de l'infrastructure de test : sur SQLite, une colonne UUID doit avoir l'affinité texte (voir tests/conftest.py).
Sans cela, un identifiant dont l'écriture hexadécimale ressemble à un nombre revenait converti en flottant
(« AttributeError: 'float' object has no attribute 'replace' »), environ 3 % des passes complètes de la suite.
"""
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.session import Base
from app.models.organisation import Organisation

IDENTIFIANTS = {
    "lettres": "0123456789abcdef0123456789abcdef",
    "32_chiffres_sans_lettre": "12345678123456781234567812345678",
    "chiffres_avec_un_seul_e": "1234567812345678123456781234e678",
}


@pytest.fixture()
def session():
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    for table in Base.metadata.sorted_tables:
        try:
            table.create(engine, checkfirst=True)
        except Exception:  # noqa: BLE001 — tables propres à PostgreSQL
            pass
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


@pytest.mark.parametrize("hexa", IDENTIFIANTS.values(), ids=IDENTIFIANTS.keys())
def test_un_identifiant_revient_identique_apres_ecriture_et_relecture(session, hexa):
    identifiant = uuid.UUID(hexa)
    session.add(Organisation(id=identifiant, nom="x", active=True))
    session.commit()
    session.expire_all()
    relu = session.query(Organisation).one()
    assert relu.id == identifiant
    assert isinstance(relu.id, uuid.UUID)
    stocke = session.execute(text("SELECT typeof(id), id FROM organisations")).one()
    assert stocke == ("text", hexa)


def test_la_recherche_par_identifiant_reste_inchangee(session):
    """Le correctif ne change que la déclaration de colonne : mêmes comparaisons qu'avant."""
    identifiant = uuid.UUID(IDENTIFIANTS["lettres"])
    session.add(Organisation(id=identifiant, nom="x", active=True))
    session.commit()
    assert session.query(Organisation).filter(Organisation.id == identifiant).count() == 1
    assert session.get(Organisation, identifiant) is not None
    # Une chaîne n'est toujours pas un UUID : la comparaison Python reste fausse, et une chaîne n'est pas acceptée en filtre.
    assert session.query(Organisation).one().id != str(identifiant)
    with pytest.raises(Exception):
        session.query(Organisation).filter(Organisation.id == str(identifiant)).count()
