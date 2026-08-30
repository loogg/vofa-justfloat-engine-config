QT -= gui

TEMPLATE = app
TARGET = plugin-smoke
CONFIG += console c++11
CONFIG -= app_bundle

SOURCES += main.cpp
HEADERS += ../../../../dataengines/shared/dataengineinterface.h
INCLUDEPATH += ../../../../dataengines/shared
