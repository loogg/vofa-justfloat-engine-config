QT -= gui

TEMPLATE = app
TARGET = plugin-smoke
CONFIG += console c++11
CONFIG -= app_bundle

SOURCES += main.cpp
isEmpty(VOFA_SHARED_DIR): VOFA_SHARED_DIR = $$PWD/../fixtures/vofa-repository/dataengines/shared
HEADERS += $$VOFA_SHARED_DIR/dataengineinterface.h
INCLUDEPATH += $$VOFA_SHARED_DIR
